import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommit } from '../../../cli/commands/commit'
import type { AppContainer } from '../../../cli/container'
import type { DveConfig } from '../../../cli/config'
import type { HumanIOPort, PresenterPort } from '../../../application/ports'
import type {
  Assumption,
  SessionStateRecord,
  Spike,
} from '../../../domain/types'
import { YamlGraphStore } from '../../../infrastructure/graph/yaml-graph.store'
import { FileSessionStore } from '../../../infrastructure/store/file-session.store'
import { SessionService } from '../../../application/session/session-service'

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

function makeContainer(tmpDir: string, humanIO?: MockHumanIO): AppContainer {
  const config = makeTestConfig(tmpDir)
  const presenter = new MockPresenter()
  const io = humanIO ?? new MockHumanIO()
  const graphStore = new YamlGraphStore(tmpDir)
  const sessionStore = new FileSessionStore(tmpDir)
  const sessionService = new SessionService(sessionStore, graphStore)

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
    createSessionPipeline: () => ({}) as never,
  }
}

const VALID_SESSION_STATE: SessionStateRecord = {
  state: 'COMMIT',
  decision_id: undefined,
  metadata: {
    goal: 'Choose a database technology',
    decisionType: 'architecture',
    residue: 'If the DB choice fails, fall back to PostgreSQL',
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const VALID_ASSUMPTION: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'PostgreSQL handles our write throughput',
  origin: { decision: 'DEC-2026-001' },
  status: 'validated',
  tags: ['database', 'performance'],
  related_assumptions: [],
}

const BET_ASSUMPTION: Assumption = {
  id: 'ASM-2026-002',
  class: 'technical',
  statement: 'Connection pooling will handle 10k concurrent connections',
  origin: { decision: 'DEC-2026-001' },
  status: 'accepted-bet',
  implication: {
    summary: 'If wrong, need connection proxy',
    signal_type: 'type-2',
  },
  tags: ['database', 'scaling'],
  related_assumptions: ['ASM-2026-001'],
}

const VALID_SPIKE: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Can PostgreSQL handle 5k writes/sec?',
  scope: { timebox_days: 3, isolated: true, approved_by: 'alice' },
  result: {
    answer: 'yes',
    finding: 'Achieved 8k writes/sec on standard hardware',
  },
  executed_by: 'engine',
  reveals_assumptions: [],
  triggers_spikes: [],
}

describe('runCommit', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-commit-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns error when no active session exists', async () => {
    const container = makeContainer(tmpDir)
    const result = await runCommit(container)

    expect(result.committed).toBe(false)
    expect(result.sessionCleared).toBe(false)
    expect(
      (container.presenter as MockPresenter).errors.some((e) =>
        e.includes('No active session'),
      ),
    ).toBe(true)
  })

  it('returns error when session is not in COMMIT state', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState({
      ...VALID_SESSION_STATE,
      state: 'SCOPING',
    })

    const result = await runCommit(container)

    expect(result.committed).toBe(false)
    expect(
      (container.presenter as MockPresenter).errors.some((e) =>
        e.includes('SCOPING'),
      ),
    ).toBe(true)
  })

  it('returns error when no signatories are provided', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses([''])
    humanIO.setConfirms([])

    const result = await runCommit(container)

    expect(result.committed).toBe(false)
    expect(
      (container.presenter as MockPresenter).errors.some((e) =>
        e.includes('signatory'),
      ),
    ).toBe(true)
  })

  it('stops when signatory declines the open bets', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(BET_ASSUMPTION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', ''])
    humanIO.setConfirms([false])

    const result = await runCommit(container)

    expect(result.committed).toBe(false)
  })

  it('commits successfully with one signatory and no drafts', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    const result = await runCommit(container)

    expect(result.committed).toBe(true)
    expect(result.decisionId).toMatch(/^DEC-\d{4}-\d{3}$/)
    expect(result.signatoriesCount).toBe(1)
    expect(result.sessionCleared).toBe(true)

    const records = await container.graphStore.readRecords()
    expect(records.length).toBe(1)
    expect(records[0]!.goal).toBe('Choose a database technology')
    expect(records[0]!.commit_signatories.length).toBe(1)
    expect(records[0]!.commit_signatories[0]!.name).toBe('Alice')
  })

  it('commits with multiple signatories', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', 'Bob', '', ''])
    humanIO.setConfirms([true, true, true, false])

    const result = await runCommit(container)

    expect(result.committed).toBe(true)
    expect(result.signatoriesCount).toBe(2)

    const records = await container.graphStore.readRecords()
    expect(records[0]!.commit_signatories.length).toBe(2)
    const names = records[0]!.commit_signatories.map((s) => s.name)
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
  })

  it('writes draft assumptions and spikes as permanent records', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(VALID_ASSUMPTION)
    await store.saveDraft(BET_ASSUMPTION)
    await store.saveDraft(VALID_SPIKE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    const result = await runCommit(container)

    expect(result.committed).toBe(true)
    expect(result.recordsWritten).toBe(4)

    const assumptions = await container.graphStore.readAssumptions()
    expect(assumptions.length).toBe(2)

    const spikes = await container.graphStore.readSpikes()
    expect(spikes.length).toBe(1)
  })

  it('clears session after successful commit', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const state = await store.loadState()
    expect(state).toBeNull()
  })

  it('displays commit brief with assumption counts', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(VALID_ASSUMPTION)
    await store.saveDraft(BET_ASSUMPTION)
    await store.saveDraft(VALID_SPIKE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const presenter = container.presenter as MockPresenter
    expect(
      presenter.messages.some((m) => m.includes('Validated assumptions: 1')),
    ).toBe(true)
    expect(presenter.messages.some((m) => m.includes('Accepted bets: 1'))).toBe(
      true,
    )
  })

  it('displays spike results in brief', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(VALID_SPIKE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const presenter = container.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('SPK-2026-001'))).toBe(
      true,
    )
    expect(presenter.messages.some((m) => m.includes('8k writes/sec'))).toBe(
      true,
    )
  })

  it('suggests arc42 sections to update', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(VALID_ASSUMPTION)
    await store.saveDraft(VALID_SPIKE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const presenter = container.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('arc42 sections'))).toBe(
      true,
    )
  })

  it('displays git commit suggestion', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const presenter = container.presenter as MockPresenter
    expect(
      presenter.messages.some((m) => m.includes('git add decisions/')),
    ).toBe(true)
  })

  it('writes valid YAML decision record', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    const result = await runCommit(container)

    const decisionFile = resolve(tmpDir, 'records', `${result.decisionId}.yaml`)
    expect(existsSync(decisionFile)).toBe(true)
  })

  it('ranks accepted bets by risk', async () => {
    const container = makeContainer(tmpDir)
    const store = container.sessionStore as FileSessionStore
    await store.saveState(VALID_SESSION_STATE)
    await store.saveDraft(VALID_ASSUMPTION)
    await store.saveDraft(BET_ASSUMPTION)

    const humanIO = container.humanIO as MockHumanIO
    humanIO.setResponses(['Alice', '', ''])
    humanIO.setConfirms([true, false])

    await runCommit(container)

    const presenter = container.presenter as MockPresenter
    const betMessages = presenter.messages.filter((m) =>
      m.includes('Accepted Bets'),
    )
    expect(betMessages.length).toBeGreaterThan(0)
    expect(presenter.messages.some((m) => m.includes('ASM-2026-002'))).toBe(
      true,
    )
  })
})
