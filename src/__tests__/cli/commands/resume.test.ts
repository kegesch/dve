import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runResume } from '../../../cli/commands/resume'
import type { AppContainer } from '../../../cli/container'
import type { DveConfig } from '../../../cli/config'
import type {
  HumanIOPort,
  PresenterPort,
  ConversationMessage,
  AgentEvent,
  ToolPort,
} from '../../../application/ports'
import type {
  SessionStateRecord,
  Assumption,
  Spike,
  SessionState,
} from '../../../domain/types'
import type { SessionData } from '../../../domain/state-machine/states'
import type { PipelineResult } from '../../../application/engine/types'
import { YamlGraphStore } from '../../../infrastructure/graph/yaml-graph.store'
import { FileSessionStore } from '../../../infrastructure/store/file-session.store'
import { SessionService } from '../../../application/session/session-service'
import { Pipeline } from '../../../application/engine/pipeline'

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
  displayProgress(): void {}
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

class MockPipeline extends Pipeline {
  private mockResult: PipelineResult | null = null

  setMockResult(result: PipelineResult): void {
    this.mockResult = result
  }

  override async run(initialState: SessionState): Promise<PipelineResult> {
    if (this.mockResult) return this.mockResult
    return {
      completed: false,
      finalState: initialState,
      iterations: 1,
      messages: [],
    }
  }
}

function makeContainer(
  tmpDir: string,
  humanIO?: MockHumanIO,
  pipeline?: Pipeline,
): AppContainer {
  const config = makeTestConfig(tmpDir)
  const presenter = new MockPresenter()
  const io = humanIO ?? new MockHumanIO()
  const graphStore = new YamlGraphStore(tmpDir)
  const sessionStore = new FileSessionStore(tmpDir)
  const sessionService = new SessionService(sessionStore, graphStore)

  const fallbackPipeline = new MockPipeline({
    agent: {
      async *run(): AsyncGenerator<AgentEvent> {
        yield { type: 'done', summary: '' }
      },
    } as never,
    tools: [] as ToolPort[],
    presenter,
    humanIO: io,
  })
  fallbackPipeline.setMockResult({
    completed: false,
    finalState: 'STRESS_TESTING',
    iterations: 1,
    messages: [],
  })

  const usePipeline = pipeline ?? fallbackPipeline

  return {
    config,
    agent: {} as never,
    graphStore,
    sessionStore,
    presenter,
    humanIO: io,
    spikeRunner: {} as never,
    parsers: {} as never,
    sessionService,
    createSessionPipeline: () => usePipeline as Pipeline,
  }
}

const INTERRUPTED_SESSION: SessionStateRecord = {
  state: 'STRESS_TESTING',
  decision_id: undefined,
  metadata: { goal: 'Choose a caching strategy' },
  created_at: '2026-03-30T10:00:00.000Z',
  updated_at: '2026-03-30T10:15:00.000Z',
}

const COMMIT_SESSION: SessionStateRecord = {
  state: 'COMMIT',
  decision_id: undefined,
  metadata: { goal: 'Choose a database' },
  created_at: '2026-03-30T10:00:00.000Z',
  updated_at: '2026-03-30T10:30:00.000Z',
}

const DRAFT_ASSUMPTION: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'Redis handles our throughput needs',
  origin: { decision: 'DEC-2026-001' },
  status: 'validated',
  tags: ['caching', 'performance'],
  related_assumptions: [],
}

const DRAFT_SPIKE: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Can Redis handle 50k ops/sec?',
  scope: { timebox_days: 2, isolated: true, approved_by: 'alice' },
  result: undefined,
  executed_by: 'engine',
  reveals_assumptions: [],
  triggers_spikes: [],
}

describe('runResume', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-resume-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns error when no session exists', async () => {
    const container = makeContainer(tmpDir)
    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    expect(result.summary).toBeNull()
    expect(
      (container.presenter as MockPresenter).errors.some((e) =>
        e.includes('No interrupted session'),
      ),
    ).toBe(true)
  })

  it('returns info when session is already at COMMIT', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(COMMIT_SESSION)

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    expect(result.finalState).toBe('COMMIT')
    expect(
      (container.presenter as MockPresenter).messages.some((m) =>
        m.includes('dve commit'),
      ),
    ).toBe(true)
  })

  it('displays session summary before resuming', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)
    await store.saveDraft(DRAFT_ASSUMPTION)
    await store.saveDraft(DRAFT_SPIKE)
    await store.appendConversation({
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    })

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([false, false])

    const result = await runResume(container)

    expect(result.summary).not.toBeNull()
    expect(result.summary!.state).toBe('STRESS_TESTING')
    expect(result.summary!.goal).toBe('Choose a caching strategy')
    expect(result.summary!.assumptionsDrafted).toBe(1)
    expect(result.summary!.spikesDrafted).toBe(1)
    expect(result.summary!.conversationTurns).toBe(1)

    const presenter = container.presenter as MockPresenter
    expect(
      presenter.messages.some((m) => m.includes('Choose a caching strategy')),
    ).toBe(true)
    expect(presenter.messages.some((m) => m.includes('STRESS_TESTING'))).toBe(
      true,
    )
    expect(
      presenter.messages.some((m) => m.includes('Assumptions drafted: 1')),
    ).toBe(true)
  })

  it('does not resume when user declines', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([false, false])

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    const state = await store.loadState()
    expect(state).not.toBeNull()
  })

  it('discards session when user declines then confirms discard', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([false, true])

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    const state = await store.loadState()
    expect(state).toBeNull()

    const presenter = container.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('discarded'))).toBe(true)
  })

  it('keeps session when user declines and does not discard', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([false, false])

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    const state = await store.loadState()
    expect(state).not.toBeNull()
  })

  it('resumes session and runs pipeline from saved state', async () => {
    const mockPipeline = new MockPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })
    mockPipeline.setMockResult({
      completed: false,
      finalState: 'SPIKE_PLANNING',
      iterations: 3,
      messages: [],
    })

    const container = makeContainer(tmpDir, undefined, mockPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)
    await store.saveDraft(DRAFT_ASSUMPTION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true])

    const result = await runResume(container)

    expect(result.resumed).toBe(true)
    expect(result.finalState).toBe('SPIKE_PLANNING')
    expect(result.completed).toBe(false)

    const state = await store.loadState()
    expect(state).not.toBeNull()
    expect(state!.state).toBe('SPIKE_PLANNING')
  })

  it('completes session when pipeline reaches COMMIT', async () => {
    const mockPipeline = new MockPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })
    mockPipeline.setMockResult({
      completed: true,
      finalState: 'COMMIT',
      iterations: 5,
      messages: [],
    })

    const container = makeContainer(tmpDir, undefined, mockPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)
    await store.saveDraft(DRAFT_ASSUMPTION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true])

    const result = await runResume(container)

    expect(result.resumed).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.finalState).toBe('COMMIT')

    const state = await store.loadState()
    expect(state).toBeNull()

    const presenter = container.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('completed'))).toBe(true)
  })

  it('reconstructs conversation history for pipeline', async () => {
    let capturedMessages: ConversationMessage[] = []

    class CapturingPipeline extends Pipeline {
      override async run(
        _initialState: SessionState,
        _sessionData: SessionData,
        initialMessages: readonly ConversationMessage[] = [],
      ): Promise<PipelineResult> {
        capturedMessages = [...initialMessages]
        return {
          completed: false,
          finalState: _initialState,
          iterations: 1,
          messages: [],
        }
      }
    }

    const capturingPipeline = new CapturingPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })

    const container = makeContainer(tmpDir, undefined, capturingPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)
    await store.appendConversation({
      role: 'user',
      content: 'What about Redis?',
      timestamp: new Date().toISOString(),
    })
    await store.appendConversation({
      role: 'assistant',
      content: 'Redis is a good option',
      timestamp: new Date().toISOString(),
    })

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true])

    await runResume(container)

    expect(capturedMessages.length).toBe(3)
    expect(capturedMessages[0]!.content).toBe('What about Redis?')
    expect(capturedMessages[1]!.content).toBe('Redis is a good option')
    expect(capturedMessages[2]!.content).toContain('Resuming session')
    expect(capturedMessages[2]!.role).toBe('user')
  })

  it('counts approved spikes in session data', async () => {
    let capturedData: SessionData | null = null

    class DataCapturingPipeline extends Pipeline {
      override async run(
        _initialState: SessionState,
        sessionData: SessionData,
      ): Promise<PipelineResult> {
        capturedData = sessionData
        return {
          completed: false,
          finalState: _initialState,
          iterations: 1,
          messages: [],
        }
      }
    }

    const dataPipeline = new DataCapturingPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })

    const container = makeContainer(tmpDir, undefined, dataPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)
    await store.saveDraft(DRAFT_ASSUMPTION)
    await store.saveDraft(DRAFT_SPIKE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true])

    await runResume(container)

    expect(capturedData).not.toBeNull()
    expect(capturedData!.assumptions).toBe(1)
    expect(capturedData!.approvedSpikes).toBe(1)
  })

  it('handles error gracefully and offers to clear session', async () => {
    class FailingPipeline extends Pipeline {
      override async run(): Promise<PipelineResult> {
        throw new Error('Corrupted session data')
      }
    }

    const failPipeline = new FailingPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })

    const container = makeContainer(tmpDir, undefined, failPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true, true])

    const result = await runResume(container)

    expect(result.resumed).toBe(false)
    expect(result.summary).not.toBeNull()

    const presenter = container.presenter as MockPresenter
    expect(
      presenter.errors.some((e) => e.includes('Corrupted session data')),
    ).toBe(true)

    const state = await store.loadState()
    expect(state).toBeNull()
  })

  it('does not clear session on error if user declines', async () => {
    class FailingPipeline extends Pipeline {
      override async run(): Promise<PipelineResult> {
        throw new Error('Corrupted session data')
      }
    }

    const failPipeline = new FailingPipeline({
      agent: {} as never,
      tools: [],
      presenter: new MockPresenter(),
      humanIO: new MockHumanIO(),
    })

    const container = makeContainer(tmpDir, undefined, failPipeline)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(INTERRUPTED_SESSION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setConfirms([true, false])

    await runResume(container)

    const state = await store.loadState()
    expect(state).not.toBeNull()
  })
})
