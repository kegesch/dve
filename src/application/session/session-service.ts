import type { SessionStorePort, GraphStorePort } from '../ports'
import type { SessionStateRecord } from '../../domain/types'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import { SessionStateSchema } from '../../domain/validation/schemas'

export class SessionService {
  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly graphStore: GraphStorePort,
  ) {}

  async startNewSession(goal: string): Promise<SessionStateRecord> {
    const now = new Date().toISOString()
    const state: SessionStateRecord = SessionStateSchema.parse({
      state: 'SCOPING',
      decision_id: undefined,
      metadata: { goal },
      created_at: now,
      updated_at: now,
    })
    await this.sessionStore.saveState(state)
    return state
  }

  async resumeSession(): Promise<{
    state: SessionStateRecord
    graph: KnowledgeGraph
  } | null> {
    const state = await this.sessionStore.loadState()
    if (!state) return null

    const graph = await this.loadGraph()
    return { state, graph }
  }

  async endSession(): Promise<void> {
    const drafts = await this.sessionStore.loadDrafts()

    for (const assumption of drafts.assumptions) {
      await this.graphStore.writeAssumption(assumption)
    }
    for (const spike of drafts.spikes) {
      await this.graphStore.writeSpike(spike)
    }

    await this.sessionStore.clear()
  }

  async updateState(state: SessionStateRecord): Promise<void> {
    const now = new Date().toISOString()
    const updated = SessionStateSchema.parse({
      ...state,
      updated_at: now,
    })
    await this.sessionStore.saveState(updated)
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    const graph = new KnowledgeGraph()
    const [assumptions, spikes, records] = await Promise.all([
      this.graphStore.readAssumptions(),
      this.graphStore.readSpikes(),
      this.graphStore.readRecords(),
    ])
    for (const a of assumptions) graph.addNode(a)
    for (const s of spikes) graph.addNode(s)
    for (const r of records) graph.addNode(r)
    return graph
  }
}
