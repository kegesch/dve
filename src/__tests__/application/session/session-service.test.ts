import { describe, test, expect, mock } from 'bun:test'
import type {
  SessionStorePort,
  ConversationEntry,
  GraphStorePort,
} from '../../../application/ports'
import type {
  Assumption,
  Decision,
  SessionStateRecord,
  Spike,
} from '../../../domain/types'
import { SessionService } from '../../../application/session/session-service'

function createMockSessionStore(drafts?: {
  assumptions: Assumption[]
  spikes: Spike[]
}): SessionStorePort {
  let savedState: SessionStateRecord | null = null
  const conversation: ConversationEntry[] = []

  return {
    saveState: mock(async (state: SessionStateRecord) => {
      savedState = state
    }),
    loadState: mock(async () => savedState),
    appendConversation: mock(async (entry: ConversationEntry) => {
      conversation.push(entry)
    }),
    loadConversation: mock(async () => conversation),
    saveDraft: mock(async () => {}),
    loadDrafts: mock(async () => drafts ?? { assumptions: [], spikes: [] }),
    clear: mock(async () => {
      savedState = null
      conversation.length = 0
    }),
  }
}

function createMockGraphStore(
  assumptions: Assumption[] = [],
  spikes: Spike[] = [],
  records: Decision[] = [],
): GraphStorePort {
  const stored = {
    assumptions: [...assumptions],
    spikes: [...spikes],
    records: [...records],
  }

  return {
    readRecords: mock(async () => stored.records),
    writeRecord: mock(async () => {}),
    readAssumptions: mock(async () => stored.assumptions),
    writeAssumption: mock(async (a: Assumption) => {
      stored.assumptions.push(a)
    }),
    readSpikes: mock(async () => stored.spikes),
    writeSpike: mock(async (s: Spike) => {
      stored.spikes.push(s)
    }),
    readContext: mock(async () => ({
      arc42: null,
      stack: null,
      gaps: null,
    })),
    writeContext: mock(async () => {}),
  }
}

const sampleAssumption: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'Test assumption',
  origin: { decision: 'DEC-2026-001' },
  status: 'unvalidated',
  tags: ['test'],
  related_assumptions: [],
}

const sampleSpike: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Does it work?',
  scope: { timebox_days: 1, isolated: true, approved_by: 'test' },
  reveals_assumptions: [],
  triggers_spikes: [],
}

const sampleDecision: Decision = {
  id: 'DEC-2026-001',
  type: 'architecture',
  status: 'active',
  goal: 'Test goal',
  assumptions: { validated: [], invalidated: [], accepted_bets: [] },
  residue: '',
  commit_signatories: [],
  arc42_sections_affected: [],
  code_refs: [],
}

describe('SessionService', () => {
  describe('startNewSession', () => {
    test('creates session in SCOPING state with goal', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      const state = await service.startNewSession('Build auth system')

      expect(state.state).toBe('SCOPING')
      expect(state.metadata).toEqual({ goal: 'Build auth system' })
      expect(state.created_at).toBeDefined()
      expect(state.updated_at).toBeDefined()
      expect(store.saveState).toHaveBeenCalledTimes(1)
    })

    test('sets decision_id as undefined initially', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      const state = await service.startNewSession('Goal')

      expect(state.decision_id).toBeUndefined()
    })
  })

  describe('resumeSession', () => {
    test('returns null when no session exists', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      const result = await service.resumeSession()

      expect(result).toBeNull()
    })

    test('restores session state and loads graph', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore(
        [sampleAssumption],
        [sampleSpike],
        [sampleDecision],
      )
      const service = new SessionService(store, graphStore)

      await service.startNewSession('Goal')
      const result = await service.resumeSession()

      expect(result).not.toBeNull()
      expect(result!.state.state).toBe('SCOPING')
      expect(result!.graph.size.nodes).toBe(3)
    })
  })

  describe('endSession', () => {
    test('commits draft assumptions to graph store', async () => {
      const store = createMockSessionStore({
        assumptions: [sampleAssumption],
        spikes: [],
      })
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      await service.endSession()

      expect(graphStore.writeAssumption).toHaveBeenCalledTimes(1)
      expect(graphStore.writeAssumption).toHaveBeenCalledWith(sampleAssumption)
    })

    test('commits draft spikes to graph store', async () => {
      const store = createMockSessionStore({
        assumptions: [],
        spikes: [sampleSpike],
      })
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      await service.endSession()

      expect(graphStore.writeSpike).toHaveBeenCalledTimes(1)
      expect(graphStore.writeSpike).toHaveBeenCalledWith(sampleSpike)
    })

    test('clears session store after committing', async () => {
      const store = createMockSessionStore({
        assumptions: [sampleAssumption],
        spikes: [],
      })
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      await service.endSession()

      expect(store.clear).toHaveBeenCalledTimes(1)
    })

    test('handles empty drafts', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      await service.endSession()

      expect(graphStore.writeAssumption).not.toHaveBeenCalled()
      expect(graphStore.writeSpike).not.toHaveBeenCalled()
      expect(store.clear).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateState', () => {
    test('persists updated state with new timestamp', async () => {
      const store = createMockSessionStore()
      const graphStore = createMockGraphStore()
      const service = new SessionService(store, graphStore)

      const state = await service.startNewSession('Goal')
      const updated = { ...state, state: 'DECOMPOSING' as const }
      await service.updateState(updated)

      expect(store.saveState).toHaveBeenCalledTimes(2)
    })
  })

  describe('loadGraph', () => {
    test('builds knowledge graph from store data', async () => {
      const graphStore = createMockGraphStore(
        [sampleAssumption],
        [sampleSpike],
        [sampleDecision],
      )
      const store = createMockSessionStore()
      const service = new SessionService(store, graphStore)

      const graph = await service.loadGraph()

      expect(graph.size.nodes).toBe(3)
      expect(graph.getNode('ASM-2026-001')).toBeDefined()
      expect(graph.getNode('SPK-2026-001')).toBeDefined()
      expect(graph.getNode('DEC-2026-001')).toBeDefined()
    })

    test('returns empty graph when no records exist', async () => {
      const graphStore = createMockGraphStore()
      const store = createMockSessionStore()
      const service = new SessionService(store, graphStore)

      const graph = await service.loadGraph()

      expect(graph.size.nodes).toBe(0)
      expect(graph.size.edges).toBe(0)
    })
  })
})
