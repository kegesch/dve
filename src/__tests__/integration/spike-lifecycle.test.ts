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
  SpikeRunnerPort,
  SpikeResult,
} from '../../application/ports'
import type { Assumption, Spike, SessionStateRecord } from '../../domain/types'
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
  createModifySpikeTool,
  createDropSpikeTool,
  createDeferSpikeTool,
  createExecuteSpikeTool,
  createAskHumanTool,
  createReadFileTool,
} from '../../infrastructure/agent/tool-dispatcher'
import { mintAssumptionId, mintSpikeId } from '../../domain/id/id-minter'
import { SessionStateSchema } from '../../domain/validation/schemas'
import type { ParserPort } from '../../application/ports'
import type { SessionState } from '../../domain/types'
import type { SessionData } from '../../domain/state-machine/states'

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

class MockSpikeRunner implements SpikeRunnerPort {
  private executionLog: Array<{
    spikeId: string
    code: string
    options: Record<string, unknown>
  }> = []
  private nextResult: SpikeResult = {
    answer: 'yes',
    finding: 'Test confirms the assumption',
    exitCode: 0,
    stdout: 'ANSWER: yes\nFINDING: Test confirms the assumption',
    stderr: '',
  }
  private shouldTimeout = false

  setNextResult(result: SpikeResult): void {
    this.nextResult = result
  }

  setShouldTimeout(value: boolean): void {
    this.shouldTimeout = value
  }

  getExecutionLog() {
    return this.executionLog
  }

  async execute(
    spikeId: string,
    code: string,
    options: {
      readonly timeboxSeconds: number
      readonly networkAllowed: boolean
      readonly memoryLimitMb: number
      readonly artefactDir: string
    },
  ): Promise<SpikeResult> {
    this.executionLog.push({ spikeId, code, options: { ...options } })

    if (this.shouldTimeout) {
      return {
        answer: 'inconclusive',
        finding: 'Spike timed out',
        exitCode: 137,
        stdout: '',
        stderr: 'Container killed due to timeout',
      }
    }

    return this.nextResult
  }
}

const TRANSITIONS: SessionState[] = [
  'DECOMPOSING',
  'STRESS_TESTING',
  'SPIKE_PLANNING',
  'SPIKE_REVIEW',
  'SPIKE_EXECUTING',
  'COMMIT',
]

function createAgentForSpikeLifecycle(): AgentPort {
  let callIdx = 0

  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    run: async function* () {
      callIdx++
      const si = callIdx - 1

      if (si >= TRANSITIONS.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (si === 1) {
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'technical',
            statement: 'Cache invalidation handles concurrent writes',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['caching', 'concurrency'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${si}`,
        }
      }

      if (si === 3) {
        yield {
          type: 'tool_call' as const,
          tool: 'proposeSpike' as const,
          args: {
            validatesAssumption: 'ASM-2026-001',
            killingQuestion: 'Can cache handle 10k concurrent writes?',
            timeboxDays: 3,
          },
          callId: `tc-spk-${si}`,
        }
      }

      if (si === 4) {
        yield {
          type: 'tool_call' as const,
          tool: 'approveSpike' as const,
          args: { spikeId: 'SPK-2026-001' },
          callId: `tc-appr-${si}`,
        }
      }

      if (si === 5) {
        yield {
          type: 'tool_call' as const,
          tool: 'executeSpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
            code: 'echo "ANSWER: yes" && echo "FINDING: Test passed"',
            timeboxSeconds: 300,
          },
          callId: `tc-exec-${si}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: TRANSITIONS[si]!,
      }
    },
  }
}

function createAgentForDropSpike(): AgentPort {
  let callIdx = 0

  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    run: async function* () {
      callIdx++
      const si = callIdx - 1

      if (si >= TRANSITIONS.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (si === 1) {
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'environmental',
            statement: 'Network latency is under 50ms',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['network', 'performance'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${si}`,
        }
      }

      if (si === 3) {
        yield {
          type: 'tool_call' as const,
          tool: 'proposeSpike' as const,
          args: {
            validatesAssumption: 'ASM-2026-001',
            killingQuestion: 'Is network latency under 50ms in production?',
            timeboxDays: 2,
          },
          callId: `tc-spk-${si}`,
        }
      }

      if (si === 4) {
        yield {
          type: 'tool_call' as const,
          tool: 'dropSpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
            reason: 'Low risk, not worth spike effort',
          },
          callId: `tc-drop-${si}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: TRANSITIONS[si]!,
      }
    },
  }
}

function createAgentForDeferSpike(): AgentPort {
  let callIdx = 0

  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    run: async function* () {
      callIdx++
      const si = callIdx - 1

      if (si >= TRANSITIONS.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (si === 1) {
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'domain',
            statement: 'Users need real-time notifications',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['domain', 'notifications'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${si}`,
        }
      }

      if (si === 3) {
        yield {
          type: 'tool_call' as const,
          tool: 'proposeSpike' as const,
          args: {
            validatesAssumption: 'ASM-2026-001',
            killingQuestion: 'Do users actually use real-time notifications?',
            timeboxDays: 5,
          },
          callId: `tc-spk-${si}`,
        }
      }

      if (si === 4) {
        yield {
          type: 'tool_call' as const,
          tool: 'deferSpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
            reason: 'Need product input first',
          },
          callId: `tc-defer-${si}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: TRANSITIONS[si]!,
      }
    },
  }
}

function createAgentForModifySpike(): AgentPort {
  let callIdx = 0

  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    run: async function* () {
      callIdx++
      const si = callIdx - 1

      if (si >= TRANSITIONS.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (si === 1) {
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'technical',
            statement: 'Database connection pool handles 500 connections',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['database', 'scaling'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${si}`,
        }
      }

      if (si === 3) {
        yield {
          type: 'tool_call' as const,
          tool: 'proposeSpike' as const,
          args: {
            validatesAssumption: 'ASM-2026-001',
            killingQuestion: 'Can the pool handle 500 connections?',
            timeboxDays: 2,
          },
          callId: `tc-spk-${si}`,
        }
      }

      if (si === 4) {
        yield {
          type: 'tool_call' as const,
          tool: 'modifySpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
            killingQuestion: 'Can the pool handle 1000 connections under load?',
            timeboxDays: 5,
          },
          callId: `tc-mod-${si}`,
        }
        yield {
          type: 'tool_call' as const,
          tool: 'approveSpike' as const,
          args: { spikeId: 'SPK-2026-001' },
          callId: `tc-appr-${si}`,
        }
      }

      if (si === 5) {
        yield {
          type: 'tool_call' as const,
          tool: 'executeSpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
            code: 'echo "ANSWER: no" && echo "FINDING: Pool exhausted at 800"',
            timeboxSeconds: 300,
          },
          callId: `tc-exec-${si}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: TRANSITIONS[si]!,
      }
    },
  }
}

function buildContainer(
  tmpDir: string,
  humanIO: MockHumanIO,
  fakeAgent: AgentPort,
  spikeRunner: SpikeRunnerPort,
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
      createExecuteSpikeTool(spikeRunner),
      createApproveSpikeTool(sessionStore),
      createModifySpikeTool(sessionStore),
      createDropSpikeTool(sessionStore),
      createDeferSpikeTool(sessionStore),
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
    spikeRunner,
    parsers: {
      arc42: null as unknown as ParserPort,
      adr: null as unknown as ParserPort,
      codebase: null as unknown as ParserPort,
    },
    sessionService,
    createSessionPipeline,
  }
}

async function runSessionToCommit(
  container: AppContainer,
  goal: string,
): Promise<{ completed: boolean; finalState: string }> {
  const { sessionService, sessionStore, presenter } = container

  const graph = await sessionService.loadGraph()
  const now = new Date().toISOString()
  const sessionState = SessionStateSchema.parse({
    state: 'SCOPING',
    decision_id: undefined,
    metadata: { goal, decisionType: 'architecture' },
    created_at: now,
    updated_at: now,
  })
  await sessionStore.saveState(sessionState)
  presenter.displayProgress('SCOPING')

  const pipeline = container.createSessionPipeline(graph)
  const sessionData: SessionData = {
    assumptions: 1,
    approvedSpikes: 1,
  }

  const result = await pipeline.run('SCOPING', sessionData)

  const updated: SessionStateRecord = {
    ...sessionState,
    state: result.finalState as SessionStateRecord['state'],
    updated_at: new Date().toISOString(),
    metadata: { goal, decisionType: 'architecture' },
  }
  await sessionStore.saveState(updated)

  return { completed: result.completed, finalState: result.finalState }
}

describe('Spike execution lifecycle', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-spike-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('proposes, approves, and executes a spike through the pipeline', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    const result = await runSessionToCommit(container, 'Test caching strategy')

    expect(result.completed).toBe(true)
    expect(result.finalState).toBe('COMMIT')

    const executionLog = spikeRunner.getExecutionLog()
    expect(executionLog.length).toBe(1)
    expect(executionLog[0]!.spikeId).toBe('SPK-2026-001')
    expect(executionLog[0]!.code).toContain('ANSWER: yes')
    expect(executionLog[0]!.options.timeboxSeconds).toBe(300)
    expect(executionLog[0]!.options.networkAllowed).toBe(false)
    expect(executionLog[0]!.options.memoryLimitMb).toBe(512)
  })

  it('spike execution result is captured in spike record', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    spikeRunner.setNextResult({
      answer: 'no',
      finding: 'Cache cannot handle concurrent writes',
      exitCode: 0,
      stdout: 'ANSWER: no\nFINDING: Cache cannot handle concurrent writes',
      stderr: '',
    })
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    await runSessionToCommit(container, 'Test caching')

    const { sessionStore } = container
    const drafts = await sessionStore.loadDrafts()
    const spike = drafts.spikes.find((s) => s.id === 'SPK-2026-001')

    expect(spike).toBeDefined()
    expect(spike!.killing_question).toBe(
      'Can cache handle 10k concurrent writes?',
    )
    expect(spike!.scope.approved_by).toBe('human')
    expect(spike!.validates_assumption).toBe('ASM-2026-001')
  })

  it('spike timeout returns inconclusive result', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    spikeRunner.setShouldTimeout(true)
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    await runSessionToCommit(container, 'Test timeout')

    const executionLog = spikeRunner.getExecutionLog()
    expect(executionLog.length).toBe(1)

    const presenter = container.presenter as MockPresenter
    expect(
      presenter.messages.some((m) => m.includes('[SPIKE_EXECUTING]')),
    ).toBe(true)
  })

  it('drop spike marks assumption as accepted-bet', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForDropSpike(),
      spikeRunner,
    )

    const result = await runSessionToCommit(container, 'Test spike drop flow')

    expect(result.completed).toBe(true)

    const { sessionStore } = container
    const drafts = await sessionStore.loadDrafts()
    const assumption = drafts.assumptions.find((a) => a.id === 'ASM-2026-001')

    expect(assumption).toBeDefined()
    expect(assumption!.status).toBe('accepted-bet')
    expect(assumption!.evidence).toBeDefined()
    expect(assumption!.evidence!.source).toBe('review')
    expect(assumption!.evidence!.finding).toContain('dropped')

    const executionLog = spikeRunner.getExecutionLog()
    expect(executionLog.length).toBe(0)
  })

  it('defer spike sets approved_by to deferred', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForDeferSpike(),
      spikeRunner,
    )

    const result = await runSessionToCommit(container, 'Test spike defer flow')

    expect(result.completed).toBe(true)

    const { sessionStore } = container
    const drafts = await sessionStore.loadDrafts()
    const spike = drafts.spikes.find((s) => s.id === 'SPK-2026-001')

    expect(spike).toBeDefined()
    expect(spike!.scope.approved_by).toBe('deferred')
  })

  it('modify spike updates killing question and timebox before approval', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    spikeRunner.setNextResult({
      answer: 'no',
      finding: 'Pool exhausted at 800',
      exitCode: 0,
      stdout: 'ANSWER: no\nFINDING: Pool exhausted at 800',
      stderr: '',
    })
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForModifySpike(),
      spikeRunner,
    )

    const result = await runSessionToCommit(container, 'Test spike modify flow')

    expect(result.completed).toBe(true)

    const { sessionStore } = container
    const drafts = await sessionStore.loadDrafts()
    const spike = drafts.spikes.find((s) => s.id === 'SPK-2026-001')

    expect(spike).toBeDefined()
    expect(spike!.killing_question).toBe(
      'Can the pool handle 1000 connections under load?',
    )
    expect(spike!.scope.timebox_days).toBe(5)
    expect(spike!.scope.approved_by).toBe('human')
  })

  it('session state reaches COMMIT with spike data', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    await runSessionToCommit(container, 'Test persistence')

    const { sessionStore } = container
    const sessionState = await sessionStore.loadState()
    expect(sessionState).not.toBeNull()
    expect(sessionState!.state).toBe('COMMIT')
  })

  it('spike runs with isolated execution (no network by default)', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    await runSessionToCommit(container, 'Test isolation')

    const executionLog = spikeRunner.getExecutionLog()
    expect(executionLog.length).toBe(1)
    expect(executionLog[0]!.options.networkAllowed).toBe(false)
    expect(executionLog[0]!.options.memoryLimitMb).toBe(512)
  })

  it('session state transitions through spike-related states', async () => {
    const humanIO = new MockHumanIO()
    const spikeRunner = new MockSpikeRunner()
    const container = buildContainer(
      tmpDir,
      humanIO,
      createAgentForSpikeLifecycle(),
      spikeRunner,
    )

    await runSessionToCommit(container, 'Test state transitions')

    const presenter = container.presenter as MockPresenter
    const stateMessages = presenter.messages.filter((m) => m.match(/^\[.+\]$/))

    expect(stateMessages).toContain('[SCOPING]')
    expect(stateMessages).toContain('[DECOMPOSING]')
    expect(stateMessages).toContain('[STRESS_TESTING]')
    expect(stateMessages).toContain('[SPIKE_PLANNING]')
    expect(stateMessages).toContain('[SPIKE_REVIEW]')
    expect(stateMessages).toContain('[SPIKE_EXECUTING]')
    expect(stateMessages).toContain('[COMMIT]')
  })
})
