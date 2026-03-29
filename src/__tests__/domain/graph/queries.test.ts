import { describe, expect, it } from 'bun:test'
import type {
  Assumption,
  Decision,
  Spike,
} from '../../../domain/validation/schemas'
import { KnowledgeGraph } from '../../../domain/graph/knowledge-graph'
import {
  findInvalidatedAssumptions,
  findUnvalidatedBets,
  findRelatedAssumptions,
  getImplicationChain,
  getAssumptionsForDecision,
  findRelevantAssumptions,
} from '../../../domain/graph/queries'

const asm1: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'The database can handle 10k concurrent connections',
  origin: { decision: 'DEC-2026-001' },
  status: 'invalidated',
  evidence: { source: 'production', finding: 'Maxed out at 4k connections' },
  implication: {
    summary: 'Connection pooling must be redesigned',
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

const asm4: Assumption = {
  id: 'ASM-2026-004',
  class: 'environmental',
  statement: 'Cloud provider supports auto-scaling',
  origin: { decision: 'DEC-2026-001' },
  status: 'accepted-bet',
  evidence: {
    source: 'interview',
    finding: 'DevOps confirmed but with 5min warmup',
  },
  implication: {
    summary: 'Traffic spikes may cause 5min degraded performance',
    signal_type: 'type-1',
  },
  tags: ['cloud', 'scalability'],
  related_assumptions: ['ASM-2026-001'],
}

const asm5: Assumption = {
  id: 'ASM-2026-005',
  class: 'technical',
  statement: 'Replication lag is under 100ms for read replicas',
  origin: { decision: 'DEC-2026-002' },
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
    validated: ['ASM-2026-002'],
    invalidated: ['ASM-2026-001'],
    accepted_bets: ['ASM-2026-003', 'ASM-2026-004'],
  },
  residue: 'If PostgreSQL fails to scale, fallback to CockroachDB',
  outcome: { result: 'PostgreSQL chosen', cost_weeks: 4 },
  commit_signatories: [{ name: 'Alice', signed_at: '2026-03-28T10:00:00Z' }],
  arc42_sections_affected: ['building-blocks', 'decisions'],
  code_refs: ['src/db/'],
}

const dec2: Decision = {
  id: 'DEC-2026-002',
  type: 'architecture',
  status: 'active',
  goal: 'Set up read replicas',
  assumptions: {
    validated: [],
    invalidated: [],
    accepted_bets: ['ASM-2026-005'],
  },
  residue: 'none',
  commit_signatories: [],
  arc42_sections_affected: [],
  code_refs: [],
}

const spk1: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Can PostgreSQL handle 10k concurrent connections?',
  scope: { timebox_days: 2, isolated: true, approved_by: 'Alice' },
  result: { answer: 'no', finding: 'Maxed out at 4k connections' },
  executed_by: 'engine',
  reveals_assumptions: ['ASM-2026-005'],
  triggers_spikes: [],
  artefact_path: '/decisions/spikes/artefacts/SPK-2026-001/',
}

function buildGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph()
  g.addNode(dec1)
  g.addNode(dec2)
  g.addNode(asm1)
  g.addNode(asm2)
  g.addNode(asm3)
  g.addNode(asm4)
  g.addNode(asm5)
  g.addNode(spk1)
  return g
}

describe('findInvalidatedAssumptions', () => {
  it('returns invalidated assumptions matching any tag', () => {
    const g = buildGraph()
    const result = findInvalidatedAssumptions(g, ['database'])
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-001')
    expect(ids).toHaveLength(1)
  })

  it('returns empty when no invalidated assumptions match tags', () => {
    const g = buildGraph()
    const result = findInvalidatedAssumptions(g, ['ux'])
    expect(result).toHaveLength(0)
  })

  it('returns all invalidated when tags is empty', () => {
    const g = buildGraph()
    const result = findInvalidatedAssumptions(g, [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ASM-2026-001')
  })

  it('includes provenance via origin and evidence', () => {
    const g = buildGraph()
    const result = findInvalidatedAssumptions(g, ['database'])
    const asm = result.find((a) => a.id === 'ASM-2026-001')!
    expect(asm.evidence).toBeDefined()
    expect(asm.evidence!.finding).toBe('Maxed out at 4k connections')
    expect(asm.origin.decision).toBe('DEC-2026-001')
  })

  it('matches multiple tags', () => {
    const g = buildGraph()
    const result = findInvalidatedAssumptions(g, ['scalability'])
    expect(result.map((a) => a.id)).toContain('ASM-2026-001')
  })
})

describe('findUnvalidatedBets', () => {
  it('returns accepted-bet assumptions matching tags', () => {
    const g = buildGraph()
    const result = findUnvalidatedBets(g, ['ux'])
    const ids = result.map((a) => a.id)
    expect(ids).toEqual(['ASM-2026-003'])
  })

  it('returns multiple accepted-bets matching different tags', () => {
    const g = buildGraph()
    const result = findUnvalidatedBets(g, ['scalability'])
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-004')
  })

  it('returns all accepted-bets when tags is empty', () => {
    const g = buildGraph()
    const result = findUnvalidatedBets(g, [])
    expect(result).toHaveLength(2)
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-003')
    expect(ids).toContain('ASM-2026-004')
  })

  it('returns empty when no accepted-bets match tags', () => {
    const g = buildGraph()
    const result = findUnvalidatedBets(g, ['nonexistent'])
    expect(result).toHaveLength(0)
  })
})

describe('findRelatedAssumptions', () => {
  it('returns assumptions reachable via related-to edges', () => {
    const g = buildGraph()
    const result = findRelatedAssumptions(g, 'ASM-2026-001')
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('ASM-2026-003')
    expect(ids).toContain('ASM-2026-004')
  })

  it('returns empty for isolated assumption', () => {
    const g = buildGraph()
    const result = findRelatedAssumptions(g, 'ASM-2026-005')
    expect(result).toHaveLength(0)
  })

  it('returns empty for non-existent assumption', () => {
    const g = buildGraph()
    const result = findRelatedAssumptions(g, 'ASM-9999-000')
    expect(result).toHaveLength(0)
  })

  it('handles cycles without infinite loop', () => {
    const g = new KnowledgeGraph()
    const a: Assumption = {
      id: 'ASM-2026-010',
      class: 'technical',
      statement: 'A',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-011'],
    }
    const b: Assumption = {
      id: 'ASM-2026-011',
      class: 'technical',
      statement: 'B',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-010'],
    }
    g.addNode(a)
    g.addNode(b)
    const result = findRelatedAssumptions(g, 'ASM-2026-010')
    const ids = result.map((x) => x.id)
    expect(ids).toContain('ASM-2026-011')
    expect(ids).toHaveLength(1)
  })
})

describe('getImplicationChain', () => {
  it('returns ordered chain following related-to edges outward', () => {
    const g = buildGraph()
    const result = getImplicationChain(g, 'ASM-2026-001')
    const ids = result.map((a) => a.id)
    expect(ids[0]).toBe('ASM-2026-002')
    expect(ids).toContain('ASM-2026-003')
  })

  it('returns empty for isolated assumption', () => {
    const g = buildGraph()
    const result = getImplicationChain(g, 'ASM-2026-005')
    expect(result).toHaveLength(0)
  })

  it('returns empty for non-existent assumption', () => {
    const g = buildGraph()
    const result = getImplicationChain(g, 'ASM-9999-000')
    expect(result).toHaveLength(0)
  })

  it('handles chains of depth > 2', () => {
    const g = new KnowledgeGraph()
    const a: Assumption = {
      id: 'ASM-2026-010',
      class: 'technical',
      statement: 'Root',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-011'],
    }
    const b: Assumption = {
      id: 'ASM-2026-011',
      class: 'technical',
      statement: 'Middle',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: ['ASM-2026-012'],
    }
    const c: Assumption = {
      id: 'ASM-2026-012',
      class: 'technical',
      statement: 'Leaf',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: [],
      related_assumptions: [],
    }
    g.addNode(a)
    g.addNode(b)
    g.addNode(c)
    const result = getImplicationChain(g, 'ASM-2026-010')
    const ids = result.map((x) => x.id)
    expect(ids).toEqual(['ASM-2026-011', 'ASM-2026-012'])
  })
})

describe('getAssumptionsForDecision', () => {
  it('returns all assumptions linked to a decision', () => {
    const g = buildGraph()
    const result = getAssumptionsForDecision(g, 'DEC-2026-001')
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-001')
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('ASM-2026-003')
    expect(ids).toContain('ASM-2026-004')
    expect(ids).toHaveLength(4)
  })

  it('returns assumptions for decision with single accepted bet', () => {
    const g = buildGraph()
    const result = getAssumptionsForDecision(g, 'DEC-2026-002')
    const ids = result.map((a) => a.id)
    expect(ids).toEqual(['ASM-2026-005'])
  })

  it('returns empty for decision with no assumptions', () => {
    const g = new KnowledgeGraph()
    const dec: Decision = {
      id: 'DEC-2026-099',
      type: 'feature',
      status: 'active',
      goal: 'No assumptions',
      assumptions: { validated: [], invalidated: [], accepted_bets: [] },
      residue: 'none',
      commit_signatories: [],
      arc42_sections_affected: [],
      code_refs: [],
    }
    g.addNode(dec)
    const result = getAssumptionsForDecision(g, 'DEC-2026-099')
    expect(result).toHaveLength(0)
  })

  it('returns empty for non-existent decision', () => {
    const g = buildGraph()
    const result = getAssumptionsForDecision(g, 'DEC-9999-000')
    expect(result).toHaveLength(0)
  })
})

describe('findRelevantAssumptions', () => {
  it('returns assumptions matching any tag', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, ['database'])
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-001')
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('ASM-2026-005')
  })

  it('filters by class when provided', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, ['database'], 'domain')
    expect(result).toHaveLength(0)
  })

  it('returns domain-class assumptions matching tags', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, ['latency'], 'domain')
    const ids = result.map((a) => a.id)
    expect(ids).toEqual(['ASM-2026-003'])
  })

  it('returns all matching assumptions without class filter', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, ['latency'])
    const ids = result.map((a) => a.id)
    expect(ids).toContain('ASM-2026-002')
    expect(ids).toContain('ASM-2026-003')
    expect(ids).toHaveLength(2)
  })

  it('returns empty for non-matching tags', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, ['nonexistent'])
    expect(result).toHaveLength(0)
  })

  it('returns empty when tags is empty', () => {
    const g = buildGraph()
    const result = findRelevantAssumptions(g, [])
    expect(result).toHaveLength(0)
  })
})
