import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppContainer } from '../../cli/container'
import type { DveConfig } from '../../cli/config'
import type {
  AgentPort,
  HumanIOPort,
  PresenterPort,
  ToolPort,
} from '../../application/ports'
import type { Assumption, Spike } from '../../domain/types'
import { YamlGraphStore } from '../../infrastructure/graph/yaml-graph.store'
import { FileSessionStore } from '../../infrastructure/store/file-session.store'
import { SessionService } from '../../application/session/session-service'
import { Pipeline } from '../../application/engine/pipeline'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import {
  createQueryGraphTool,
  createWriteAssumptionTool,
  createProposeSpikeTool,
  createApproveSpikeTool,
  createAskHumanTool,
  createReadFileTool,
} from '../../infrastructure/agent/tool-dispatcher'
import { mintAssumptionId, mintSpikeId } from '../../domain/id/id-minter'
import { SessionStateSchema } from '../../domain/validation/schemas'
import type { ParserPort } from '../../application/ports'
import type { SessionState } from '../../domain/types'
import { runResume } from '../../cli/commands/resume'

function makeTestConfig(tmpDir: string): DveConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'test-api-key',
    decisionsDir: tmpDir,
  }
}

class MockPresenter implements PresenterPort {
  readonly messages: string[] = []
  readonly errors: string[] = []

  display(message: string): void {
    this.messages.push(message)
  }

  displayError(error: string): void {
    this.errors.push(error)
  }

  displayTable(): void {}

  displayProgress(state: string): void {
    this.messages.push(`[${state}]`)
  }
}

class MockHumanIO implements HumanIOPort {
  private responses: string[] = []
  private confirms: boolean[] = []

  setResponses(responses: string[]): void {
    this.responses = [...responses]
  }

  setConfirms(confirms: boolean[]): void {
    this.confirms = [...confirms]
  }

  async ask(): Promise<string> {
    return this.responses.shift() ?? ''
  }

  async confirm(): Promise<boolean> {
    return this.confirms.shift() ?? false
  }

  async select<T extends string>(
    _question: string,
    options: readonly { readonly value: T; readonly label: string }[],
  ): Promise<T> {
    return options[0]!.value
  }
}

function createResumeAgent(): AgentPort {
  const transitions: SessionState[] = [
    'SPIKE_REVIEW',
    'SPIKE_EXECUTING',
    'COMMIT',
  ]
  let callIdx = 0

  return {
    id: 'fake-resume-agent',
    name: 'Fake Resume Agent',
    run: async function* () {
      callIdx++
      const si = callIdx - 1

      if (si >= transitions.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (si === 0) {
        yield {
          type: 'tool_call' as const,
          tool: 'approveSpike' as const,
          args: { spikeId: 'SPK-2026-001' },
          callId: `tc-appr-${si}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: transitions[si]!,
      }
    },
  }
}

function buildContainer(
  tmpDir: string,
  humanIO: MockHumanIO,
  fakeAgent: AgentPort,
): AppContainer {
  const config = makeTestConfig(tmpDir)
  const presenter = new MockPresenter()
  const graphStore = new YamlGraphStore(tmpDir)
  const sessionStore = new FileSessionStore(tmpDir)
  const sessionService = new SessionService(sessionStore, graphStore)

  function createSessionPipeline(graph: KnowledgeGraph): Pipeline {
    const year = new Date().getFullYear().toString()
    const tools: ToolPort[] = [
      createQueryGraphTool(graph),
      createReadFileTool(tmpDir),
      createAskHumanTool(humanIO),
      createWriteAssumptionTool(
        graphStore,
        (record) => sessionStore.saveDraft(record as Assumption),
        (ids) => mintAssumptionId(year, ids),
      ),
      createProposeSpikeTool(
        graphStore,
        (record) => sessionStore.saveDraft(record as Spike),
        (ids) => mintSpikeId(year, ids),
      ),
      createApproveSpikeTool(sessionStore),
    ]

    return new Pipeline({
      agent: fakeAgent,
      tools,
      presenter,
      humanIO,
      config: config.pipeline,
    })
  }

  return {
    config,
    agent: fakeAgent,
    graphStore,
    sessionStore,
    presenter,
    humanIO,
    spikeRunner: {} as never,
    parsers: {
      arc42: null as unknown as ParserPort,
      adr: null as unknown as ParserPort,
      codebase: null as unknown as ParserPort,
    },
    sessionService,
    createSessionPipeline,
  }
}

async function simulateCrashedSession(
  container: AppContainer,
  goal: string,
  crashState: SessionState,
): Promise<void> {
  const now = new Date().toISOString()
  const sessionState = SessionStateSchema.parse({
    state: crashState,
    decision_id: undefined,
    metadata: { goal, decisionType: 'architecture' },
    created_at: now,
    updated_at: now,
  })
  await container.sessionStore.saveState(sessionState)

  const year = new Date().getFullYear().toString()
  const assumption: Assumption = {
    id: `ASM-${year}-001`,
    class: 'technical',
    statement: 'TypeScript performance is adequate for our use case',
    origin: { decision: 'DEC-2026-000' },
    status: 'validated',
    tags: ['tech-stack', 'performance'],
    related_assumptions: [],
  }
  await container.sessionStore.saveDraft(assumption)

  const spike: Spike = {
    id: `SPK-${year}-001`,
    validates_assumption: assumption.id,
    killing_question: 'Can the system handle 10k concurrent users?',
    scope: {
      timebox_days: 3,
      isolated: true,
      approved_by: 'pending',
    },
    reveals_assumptions: [],
    triggers_spikes: [],
  }
  await container.sessionStore.saveDraft(spike)
}

describe('Session crash and resume', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-crash-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resumes session from SPIKE_PLANNING after simulated crash', async () => {
    const goal = 'Choose caching strategy'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    const stateAfterCrash = await container.sessionStore.loadState()
    expect(stateAfterCrash).not.toBeNull()
    expect(stateAfterCrash!.state).toBe('SPIKE_PLANNING')

    const draftsAfterCrash = await container.sessionStore.loadDrafts()
    expect(draftsAfterCrash.assumptions.length).toBe(1)
    expect(draftsAfterCrash.spikes.length).toBe(1)

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const resumeResult = await runResume(resumeContainer)

    expect(resumeResult.resumed).toBe(true)
    expect(resumeResult.completed).toBe(true)
    expect(resumeResult.finalState).toBe('COMMIT')
    expect(resumeResult.summary).not.toBeNull()
    expect(resumeResult.summary!.state).toBe('SPIKE_PLANNING')
    expect(resumeResult.summary!.goal).toBe(goal)
    expect(resumeResult.summary!.assumptionsDrafted).toBe(1)
    expect(resumeResult.summary!.spikesDrafted).toBe(1)
  })

  it('preserves draft data on disk before resume clears them', async () => {
    const goal = 'Choose database'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    const draftsBefore = await container.sessionStore.loadDrafts()
    expect(draftsBefore.assumptions.length).toBe(1)
    expect(draftsBefore.assumptions[0]!.statement).toBe(
      'TypeScript performance is adequate for our use case',
    )

    const secondContainer = buildContainer(
      tmpDir,
      new MockHumanIO(),
      createResumeAgent(),
    )
    const draftsReloaded = await secondContainer.sessionStore.loadDrafts()
    expect(draftsReloaded.assumptions.length).toBe(1)
    expect(draftsReloaded.assumptions[0]!.statement).toBe(
      'TypeScript performance is adequate for our use case',
    )
  })

  it('preserves session state correctly after partial pipeline run', async () => {
    const goal = 'Migrate to GraphQL'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    const savedState = await container.sessionStore.loadState()
    expect(savedState).not.toBeNull()
    expect(savedState!.state).toBe('SPIKE_PLANNING')
    expect(savedState!.metadata).toBeDefined()
    expect((savedState!.metadata as Record<string, unknown>).goal).toBe(goal)

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(true)
    expect(result.summary!.goal).toBe(goal)
  })

  it('resumed pipeline continues through remaining states', async () => {
    const goal = 'Add monitoring'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())
    await runResume(resumeContainer)

    const presenter = resumeContainer.presenter as MockPresenter
    const stateMessages = presenter.messages.filter((m) => m.match(/^\[.+\]$/))

    expect(stateMessages).toContain('[SPIKE_PLANNING]')
    expect(stateMessages).toContain('[SPIKE_REVIEW]')
    expect(stateMessages).toContain('[SPIKE_EXECUTING]')
    expect(stateMessages).toContain('[COMMIT]')
  })

  it('no data loss on crash - state and drafts survive', async () => {
    const goal = 'Replace message broker'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    const state = await container.sessionStore.loadState()
    const drafts = await container.sessionStore.loadDrafts()

    expect(state).not.toBeNull()
    expect(state!.state).toBe('SPIKE_PLANNING')
    expect(drafts.assumptions.length).toBe(1)
    expect(drafts.spikes.length).toBe(1)

    const secondHumanIO = new MockHumanIO()
    secondHumanIO.setConfirms([true])

    const resumeContainer = buildContainer(
      tmpDir,
      secondHumanIO,
      createResumeAgent(),
    )

    const reloadedState = await resumeContainer.sessionStore.loadState()
    const reloadedDrafts = await resumeContainer.sessionStore.loadDrafts()

    expect(reloadedState).not.toBeNull()
    expect(reloadedState!.state).toBe('SPIKE_PLANNING')
    expect(reloadedDrafts.assumptions.length).toBe(1)
    expect(reloadedDrafts.spikes.length).toBe(1)
  })

  it('agent context is reconstructed correctly on resume', async () => {
    const goal = 'Refactor API layer'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(true)
    expect(result.completed).toBe(true)

    const presenter = resumeContainer.presenter as MockPresenter
    const resumeMessage = presenter.messages.find((m) => m.includes('Resuming'))
    expect(resumeMessage).toBeDefined()
  })

  it('returns not found when no interrupted session exists', async () => {
    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    expect(result.interrupted).toBe(false)
    expect(result.summary).toBeNull()

    const presenter = container.presenter as MockPresenter
    expect(presenter.errors.length).toBeGreaterThan(0)
  })

  it('declines resume and discards session', async () => {
    const goal = 'Switch to NoSQL'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    const stateBefore = await container.sessionStore.loadState()
    expect(stateBefore).not.toBeNull()

    humanIO.setConfirms([false, true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(false)

    const stateAfter = await resumeContainer.sessionStore.loadState()
    expect(stateAfter).toBeNull()
  })

  it('declines resume but keeps session for later', async () => {
    const goal = 'Add rate limiting'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'SPIKE_PLANNING')

    humanIO.setConfirms([false, false])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(false)
    expect(result.summary).not.toBeNull()

    const stateAfter = await resumeContainer.sessionStore.loadState()
    expect(stateAfter).not.toBeNull()
    expect(stateAfter!.state).toBe('SPIKE_PLANNING')
  })

  it('resume works after crash at DECOMPOSING state', async () => {
    const goal = 'Add logging'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'DECOMPOSING')

    const stateBefore = await container.sessionStore.loadState()
    expect(stateBefore!.state).toBe('DECOMPOSING')

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(true)
    expect(result.summary!.state).toBe('DECOMPOSING')
  })

  it('resume works after crash at STRESS_TESTING state', async () => {
    const goal = 'Evaluate caching performance'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'STRESS_TESTING')

    const stateBefore = await container.sessionStore.loadState()
    expect(stateBefore!.state).toBe('STRESS_TESTING')

    humanIO.setConfirms([true])

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(true)
    expect(result.summary!.state).toBe('STRESS_TESTING')
  })

  it('session at COMMIT state is not resumable', async () => {
    const goal = 'Deploy to production'

    const humanIO = new MockHumanIO()
    const container = buildContainer(tmpDir, humanIO, createResumeAgent())

    await simulateCrashedSession(container, goal, 'COMMIT')

    const resumeContainer = buildContainer(tmpDir, humanIO, createResumeAgent())

    const result = await runResume(resumeContainer)

    expect(result.resumed).toBe(false)
    expect(result.finalState).toBe('COMMIT')

    const presenter = resumeContainer.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('COMMIT'))).toBe(true)
  })
})
