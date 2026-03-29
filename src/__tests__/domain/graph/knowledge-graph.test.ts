import { describe, expect, it } from 'bun:test'
import type { Assumption, Decision, Spike } from '../../../domain/validation/schemas'
import { KnowledgeGraph } from '../../../domain/graph/knowledge-graph'


const asm1: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'The database can handle 10k concurrent connections',
  origin: { decision: 'DEC-2026-001' },
  status: 'unvalidated',
  evidence: { source: 'production', finding: 'Current peak is 2k connections' },
  implication: {
    summary: 'If false, connection pooling must be redesigned',
    signal_type: 'type-1',
  },
  tags: ['database', 'scalability'],
  related_assumptions: ['ASM-2026-002'],
}

const asm2: Assumption = {
  id: 'ASM-2026-002',
  class: 'technical',
  statement: 'Connection pooling adds acceptable latency',
  origin: { decision: 'DEC-2026-001' },
  status: 'validated',
  tags: ['database', 'latency'],
  related_assumptions: ['ASM-2026-001', 'ASM-2026-003'],
}

const asm3: Assumption = {
  id: 'ASM-2026-003',
  class: 'domain',
  statement: 'Users accept a 200ms response time',
  origin: { decision: 'DEC-2026-001' },
  status: 'accepted-bet',
  tags: ['ux', 'latency'],
  related_assumptions: [],
}

const asm5: Assumption = {
  id: 'ASM-2026-005',
  class: 'technical',
  statement: 'Replication lag is under 100ms for read replicas',
  origin: { decision: 'DEC-2026-001' },
  status: 'unvalidated',
  tags: ['database', 'replication'],
  related_assumptions: [],
}

const dec1: Decision = {
  id: 'DEC-2026-001',
  type: 'architecture',
  status: 'active',
  goal: 'Choose a database strategy for the new microservice',
  assumptions: {
    validated: ['ASM-2026-001'],
    invalidated: [],
    accepted_bets: ['ASM-2026-003'],
  },
  residue: 'If PostgreSQL fails to scale, fallback to CockroachDB with minimal migration',
  outcome: {
    result: 'PostgreSQL chosen',
    cost_weeks: 4,
  },
  commit_signatories: [{ name: 'Alice', signed_at: '2026-03-28T10:00:00Z' }],
  arc42_sections_affected: ['building-blocks', 'decisions'],
  code_refs: ['src/db/', 'config/database.yaml'],
}

const spk1: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Can PostgreSQL handle 10k concurrent connections under our query load?',
  scope: { timebox_days: 2, isolated: true, approved_by: 'Alice' },
  result: { answer: 'yes', finding: 'pgbench results show 12k connections at acceptable latency' },
  executed_by: 'engine',
  reveals_assumptions: ['ASM-2026-005'],
  triggers_spikes: ['SPK-2026-002'],
  artefact_path: '/decisions/spikes/artefacts/SPK-2026-001/',
}

const spk2: Spike = {
  id: 'SPK-2026-002',
  validates_assumption: 'ASM-2026-002',
  parent_spike: 'SPK-2026-001',
  killing_question: 'Does connection pooling add acceptable latency?',
  scope: { timebox_days: 1, isolated: true, approved_by: 'Alice' },
  reveals_assumptions: [],
  triggers_spikes: [],
}

function buildGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph()
  g.addNode(dec1)
  g.addNode(asm1)
  g.addNode(asm2)
  g.addNode(asm3)
  g.addNode(asm5)
  g.addNode(spk1)
  g.addNode(spk2)
  return g
}

describe('KnowledgeGraph — population', () => {
  it('tracks node count', () => {
    const g = buildGraph()
    expect(g.size.nodes).toBe(7)
  })

  it('tracks edge count', () => {
    const g = buildGraph()
    expect(g.size.edges).toBeGreaterThan(0)
  })

  it('returns empty size for new graph', () => {
    const g = new KnowledgeGraph()
    expect(g.size).toEqual({ nodes: 0, edges: 0 })
  })
})

describe('KnowledgeGraph — getNode', () => {
  it('retrieves node by id', () => {
    const g = buildGraph()
    const node = g.getNode('ASM-2026-001')
    expect(node).toBeDefined()
    expect(node!.id).toBe('ASM-2026-001')
    expect(node!.type).toBe('assumption')
  })

  it('returns undefined for missing id', () => {
    const g = buildGraph()
    expect(g.getNode('ASM-9999-000')).toBeUndefined()
  })

  it('infers type from DEC prefix', () => {
    const g = buildGraph()
    expect(g.getNode('DEC-2026-001')!.type).toBe('decision')
  })

  it('infers type from SPK prefix', () => {
    const g = buildGraph()
    expect(g.getNode('SPK-2026-001')!.type).toBe('spike')
  })
})

describe('KnowledgeGraph — auto-edge creation', () => {
  it('creates DEC → ASM edges from assumptions lists', () => {
    const g = buildGraph()
    const edges = g.getEdges('DEC-2026-001', 'outgoing')
    const hasAssumption = edges.filter((e) => e.relation === 'has-assumption')
    const targets = hasAssumption.map((e) => e.to)
    expect(targets).toContain('ASM-2026-001')
    expect(targets).toContain('ASM-2026-003')
  })

  it('creates ASM → DEC edge from origin.decision', () => {
    const g = buildGraph()
    const edges = g.getEdges('ASM-2026-001', 'outgoing')
    const originEdge = edges.find((e) => e.relation === 'originates-from')
    expect(originEdge).toBeDefined()
    expect(originEdge!.to).toBe('DEC-2026-001')
  })

  it('creates ASM → ASM edges from related_assumptions', () => {
    const g = buildGraph()
    const edges = g.getEdges('ASM-2026-001', 'outgoing')
    const related = edges.filter((e) => e.relation === 'related-to')
    expect(related.map((e) => e.to)).toEqual(['ASM-2026-002'])
  })

  it('creates SPK → ASM edge from validates_assumption', () => {
    const g = buildGraph()
    const edges = g.getEdges('SPK-2026-001', 'outgoing')
    const validates = edges.find((e) => e.relation === 'validates')
    expect(validates).toBeDefined()
    expect(validates!.to).toBe('ASM-2026-001')
  })

  it('creates SPK → ASM edges from reveals_assumptions', () => {
    const g = buildGraph()
    const edges = g.getEdges('SPK-2026-001', 'outgoing')
    const reveals = edges.filter((e) => e.relation === 'reveals')
    expect(reveals.map((e) => e.to)).toEqual(['ASM-2026-005'])
  })

  it('creates SPK → SPK edge from triggers_spikes', () => {
    const g = buildGraph()
    const edges = g.getEdges('SPK-2026-001', 'outgoing')
    const triggers = edges.find((e) => e.relation === 'triggers')
    expect(triggers).toBeDefined()
    expect(triggers!.to).toBe('SPK-2026-002')
  })

  it('creates SPK → SPK edge from parent_spike', () => {
    const g = buildGraph()
    const edges = g.getEdges('SPK-2026-002', 'outgoing')
    const childOf = edges.find((e) => e.relation === 'child-of')
    expect(childOf).toBeDefined()
    expect(childOf!.to).toBe('SPK-2026-001')
  })
})

describe('KnowledgeGraph — getEdges', () => {
  it('returns outgoing edges by default', () => {
    const g = buildGraph()
    const edges = g.getEdges('ASM-2026-001')
    expect(edges.every((e) => e.from === 'ASM-2026-001')).toBe(true)
  })

  it('returns incoming edges', () => {
    const g = buildGraph()
    const edges = g.getEdges('ASM-2026-001', 'incoming')
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every((e) => e.to === 'ASM-2026-001')).toBe(true)
    const relations = edges.map((e) => e.relation)
    expect(relations).toContain('has-assumption')
    expect(relations).toContain('validates')
  })

  it('returns both directions', () => {
    const g = buildGraph()
    const edges = g.getEdges('ASM-2026-001', 'both')
    const hasOutgoing = edges.some((e) => e.from === 'ASM-2026-001')
    const hasIncoming = edges.some((e) => e.to === 'ASM-2026-001')
    expect(hasOutgoing).toBe(true)
    expect(hasIncoming).toBe(true)
  })

  it('returns empty for node with no edges', () => {
    const g = new KnowledgeGraph()
    g.addNode({ ...asm3, related_assumptions: [] })
    g.addNode(dec1)
    const edges = g.getEdges('ASM-2026-003', 'outgoing')
    expect(edges.length).toBe(1)
  })
})

describe('KnowledgeGraph — query', () => {
  it('filters by type', () => {
    const g = buildGraph()
    const assumptions = g.query((n) => n.type === 'assumption')
    expect(assumptions).toHaveLength(4)
  })

  it('filters by status', () => {
    const g = buildGraph()
    const unvalidated = g.query(
      (n) => n.type === 'assumption' && (n.data as Assumption).status === 'unvalidated',
    )
    expect(unvalidated).toHaveLength(2)
  })

  it('filters by tag', () => {
    const g = buildGraph()
    const dbTagged = g.query(
      (n) => n.type === 'assumption' && (n.data as Assumption).tags.includes('database'),
    )
    expect(dbTagged).toHaveLength(3)
  })

  it('returns empty for non-matching query', () => {
    const g = buildGraph()
    const result = g.query((n) => n.id === 'NONEXISTENT')
    expect(result).toHaveLength(0)
  })
})

describe('KnowledgeGraph — getNeighbors', () => {
  it('returns all directly connected nodes', () => {
    const g = buildGraph()
    const neighbors = g.getNeighbors('ASM-2026-001')
    const ids = neighbors.map((n) => n.id)
    expect(ids).toContain('DEC-2026-001')
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('SPK-2026-001')
  })

  it('excludes the node itself', () => {
    const g = buildGraph()
    const neighbors = g.getNeighbors('ASM-2026-001')
    expect(neighbors.find((n) => n.id === 'ASM-2026-001')).toBeUndefined()
  })

  it('returns empty for isolated node', () => {
    const g = new KnowledgeGraph()
    const isolated: Assumption = {
      id: 'ASM-2026-099',
      class: 'technical',
      statement: 'Nobody references me',
      origin: { decision: 'DEC-2026-099' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: [],
    }
    g.addNode(isolated)
    expect(g.getNeighbors('ASM-2026-099')).toHaveLength(0)
  })
})

describe('KnowledgeGraph — traverse', () => {
  it('follows related-to chain with depth 1', () => {
    const g = buildGraph()
    const result = g.traverse('ASM-2026-001', 'related-to', 1)
    const ids = result.map((n) => n.id)
    expect(ids).toEqual(['ASM-2026-002'])
  })

  it('follows related-to chain with depth 2', () => {
    const g = buildGraph()
    const result = g.traverse('ASM-2026-001', 'related-to', 2)
    const ids = result.map((n) => n.id)
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('ASM-2026-003')
  })

  it('handles cycles without infinite loop', () => {
    const g = new KnowledgeGraph()
    const cyclicA: Assumption = {
      id: 'ASM-2026-010',
      class: 'technical',
      statement: 'A',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-011'],
    }
    const cyclicB: Assumption = {
      id: 'ASM-2026-011',
      class: 'technical',
      statement: 'B',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-010'],
    }
    g.addNode(cyclicA)
    g.addNode(cyclicB)
    const result = g.traverse('ASM-2026-010', 'related-to', 10)
    const ids = result.map((n) => n.id)
    expect(ids).toContain('ASM-2026-011')
    expect(ids).toHaveLength(1)
  })

  it('follows triggers chain for spike hierarchy', () => {
    const g = buildGraph()
    const result = g.traverse('SPK-2026-001', 'triggers', 5)
    const ids = result.map((n) => n.id)
    expect(ids).toEqual(['SPK-2026-002'])
  })

  it('returns empty for depth 0', () => {
    const g = buildGraph()
    const result = g.traverse('ASM-2026-001', 'related-to', 0)
    expect(result).toHaveLength(0)
  })

  it('returns empty for missing start node', () => {
    const g = buildGraph()
    const result = g.traverse('ASM-9999-000', 'related-to', 5)
    expect(result).toHaveLength(0)
  })
})

describe('KnowledgeGraph — addEdge manual', () => {
  it('allows adding custom edges', () => {
    const g = buildGraph()
    const before = g.getEdges('ASM-2026-001', 'outgoing')
    const to005 = before.filter((e) => e.to === 'ASM-2026-005')
    expect(to005).toHaveLength(0)

    g.addEdge('ASM-2026-001', 'ASM-2026-005', 'related-to')
    const after = g.getEdges('ASM-2026-001', 'outgoing')
    const to005After = after.filter((e) => e.to === 'ASM-2026-005')
    expect(to005After).toHaveLength(1)
  })
})

describe('KnowledgeGraph — supersedes edge', () => {
  it('creates DEC → DEC edge from outcome.superseded_by', () => {
    const g = new KnowledgeGraph()
    const dec2: Decision = {
      id: 'DEC-2026-002',
      type: 'architecture',
      status: 'active',
      goal: 'Use CockroachDB instead',
      assumptions: { validated: [], invalidated: [], accepted_bets: [] },
      residue: 'none',
      commit_signatories: [],
      arc42_sections_affected: [],
      code_refs: [],
      outcome: { superseded_by: 'DEC-2026-001' },
    }
    g.addNode(dec2)
    const edges = g.getEdges('DEC-2026-002', 'outgoing')
    const supersedes = edges.find((e) => e.relation === 'supersedes')
    expect(supersedes).toBeDefined()
    expect(supersedes!.to).toBe('DEC-2026-001')
  })
})
