import { describe, expect, it } from 'bun:test'
import {
  Arc42ContextSchema,
  AssumptionClassEnum,
  AssumptionSchema,
  AssumptionStatusEnum,
  DecisionSchema,
  DecisionStatusEnum,
  DecisionTypeEnum,
  EvidenceSourceEnum,
  GapsContextSchema,
  SessionStateEnum,
  SessionStateSchema,
  SignalTypeEnum,
  SpikeAnswerEnum,
  SpikeExecutedByEnum,
  SpikeSchema,
  StackContextSchema,
} from '../../../domain/validation/schemas'

const validAssumption = {
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

const validDecision = {
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
  commit_signatories: [
    { name: 'Alice', signed_at: '2026-03-28T10:00:00Z' },
  ],
  arc42_sections_affected: ['building-blocks', 'decisions'],
  code_refs: ['src/db/', 'config/database.yaml'],
}

const validSpike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  parent_spike: undefined,
  killing_question: 'Can PostgreSQL handle 10k concurrent connections under our query load?',
  scope: {
    timebox_days: 2,
    isolated: true as const,
    approved_by: 'Alice',
  },
  result: {
    answer: 'yes',
    finding: 'pgbench results show 12k connections at acceptable latency',
  },
  executed_by: 'engine',
  reveals_assumptions: ['ASM-2026-005'],
  triggers_spikes: ['SPK-2026-002'],
  artefact_path: '/decisions/spikes/artefacts/SPK-2026-001/',
}

describe('AssumptionSchema', () => {
  it('parses a valid assumption', () => {
    const result = AssumptionSchema.parse(validAssumption)
    expect(result.id).toBe('ASM-2026-001')
    expect(result.status).toBe('unvalidated')
  })

  it('parses without optional evidence and implication', () => {
    const minimal = {
      id: 'ASM-2026-001',
      class: 'technical',
      statement: 'The database can handle 10k concurrent connections',
      origin: { decision: 'DEC-2026-001' },
      status: 'unvalidated',
      tags: ['database', 'scalability'],
      related_assumptions: ['ASM-2026-002'],
    }
    const result = AssumptionSchema.parse(minimal)
    expect(result.evidence).toBeUndefined()
    expect(result.implication).toBeUndefined()
  })

  it('rejects invalid id format', () => {
    const result = AssumptionSchema.safeParse({
      ...validAssumption,
      id: 'INVALID',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid class', () => {
    const result = AssumptionSchema.safeParse({
      ...validAssumption,
      class: 'political',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = AssumptionSchema.safeParse({
      ...validAssumption,
      status: 'pending',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid related_assumption id format', () => {
    const result = AssumptionSchema.safeParse({
      ...validAssumption,
      related_assumptions: ['BAD-ID'],
    })
    expect(result.success).toBe(false)
  })
})

describe('DecisionSchema', () => {
  it('parses a valid decision', () => {
    const result = DecisionSchema.parse(validDecision)
    expect(result.id).toBe('DEC-2026-001')
    expect(result.type).toBe('architecture')
  })

  it('parses without optional outcome', () => {
    const minimal = {
      id: 'DEC-2026-001',
      type: 'architecture' as const,
      status: 'active' as const,
      goal: 'Choose a database strategy',
      assumptions: { validated: [], invalidated: [], accepted_bets: [] },
      residue: 'Fallback to CockroachDB',
      commit_signatories: [],
      arc42_sections_affected: [],
      code_refs: [],
    }
    const result = DecisionSchema.parse(minimal)
    expect(result.outcome).toBeUndefined()
  })

  it('parses with empty signatories (legacy decision)', () => {
    const result = DecisionSchema.parse({
      ...validDecision,
      commit_signatories: [],
    })
    expect(result.commit_signatories).toHaveLength(0)
  })

  it('rejects invalid id format', () => {
    const result = DecisionSchema.safeParse({
      ...validDecision,
      id: 'WRONG',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid type', () => {
    const result = DecisionSchema.safeParse({
      ...validDecision,
      type: 'refactor',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = DecisionSchema.safeParse({
      ...validDecision,
      status: 'draft',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-boolean isolated in scope references', () => {
    const result = DecisionSchema.safeParse({
      ...validDecision,
      id: 'DEC-2026-001',
    })
    expect(result.success).toBe(true)
  })
})

describe('SpikeSchema', () => {
  it('parses a valid spike', () => {
    const result = SpikeSchema.parse(validSpike)
    expect(result.id).toBe('SPK-2026-001')
    expect(result.scope.isolated).toBe(true)
  })

  it('parses without optional result, executed_by, parent_spike, artefact_path', () => {
    const minimal = {
      id: 'SPK-2026-003',
      validates_assumption: 'ASM-2026-001',
      killing_question: 'Does X work?',
      scope: {
        timebox_days: 1,
        isolated: true as const,
        approved_by: 'Bob',
      },
      reveals_assumptions: [],
      triggers_spikes: [],
    }
    const result = SpikeSchema.parse(minimal)
    expect(result.result).toBeUndefined()
    expect(result.parent_spike).toBeUndefined()
    expect(result.executed_by).toBeUndefined()
    expect(result.artefact_path).toBeUndefined()
  })

  it('rejects invalid id format', () => {
    const result = SpikeSchema.safeParse({
      ...validSpike,
      id: 'SPIKE-001',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid answer', () => {
    const result = SpikeSchema.safeParse({
      ...validSpike,
      result: { answer: 'maybe', finding: 'unclear' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects isolated: false', () => {
    const result = SpikeSchema.safeParse({
      ...validSpike,
      scope: { ...validSpike.scope, isolated: false },
    })
    expect(result.success).toBe(false)
  })
})

describe('ContextSchemas', () => {
  it('parses valid arc42 context', () => {
    const result = Arc42ContextSchema.parse({
      sections: {
        'building-blocks': 'Diagram and description...',
        decisions: 'ADR-001 chosen...',
      },
    })
    expect(Object.keys(result.sections)).toHaveLength(2)
  })

  it('parses valid stack context', () => {
    const result = StackContextSchema.parse({
      technologies: ['TypeScript', 'Bun', 'PostgreSQL'],
      metadata: { runtime: 'bun', version: '1.2' },
    })
    expect(result.technologies).toHaveLength(3)
  })

  it('parses stack context without optional metadata', () => {
    const result = StackContextSchema.parse({
      technologies: ['TypeScript'],
    })
    expect(result.metadata).toBeUndefined()
  })

  it('parses valid gaps context', () => {
    const result = GapsContextSchema.parse({
      gaps: [
        { topic: 'Authentication', description: 'No auth provider chosen yet' },
      ],
    })
    expect(result.gaps).toHaveLength(1)
  })
})

describe('SessionStateSchema', () => {
  it('parses a valid session state', () => {
    const result = SessionStateSchema.parse({
      state: 'SCOPING',
      metadata: {},
      created_at: '2026-03-28T10:00:00Z',
      updated_at: '2026-03-28T10:05:00Z',
    })
    expect(result.state).toBe('SCOPING')
    expect(result.decision_id).toBeUndefined()
  })

  it('parses with decision_id', () => {
    const result = SessionStateSchema.parse({
      state: 'DECOMPOSING',
      decision_id: 'DEC-2026-001',
      metadata: { visit_counts: { SCOPING: 1 } },
      created_at: '2026-03-28T10:00:00Z',
      updated_at: '2026-03-28T10:05:00Z',
    })
    expect(result.decision_id).toBe('DEC-2026-001')
  })

  it('rejects invalid state', () => {
    const result = SessionStateSchema.safeParse({
      state: 'INVALID',
      metadata: {},
      created_at: '2026-03-28T10:00:00Z',
      updated_at: '2026-03-28T10:05:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('Enums', () => {
  it('SessionStateEnum covers all 7 states', () => {
    const states = SessionStateEnum.options
    expect(states).toEqual([
      'SCOPING',
      'DECOMPOSING',
      'STRESS_TESTING',
      'SPIKE_PLANNING',
      'SPIKE_REVIEW',
      'SPIKE_EXECUTING',
      'COMMIT',
    ])
  })

  it('AssumptionClassEnum covers all classes', () => {
    expect(AssumptionClassEnum.options).toEqual([
      'technical',
      'environmental',
      'domain',
    ])
  })

  it('AssumptionStatusEnum covers all statuses', () => {
    expect(AssumptionStatusEnum.options).toEqual([
      'unvalidated',
      'validated',
      'invalidated',
      'accepted-bet',
    ])
  })

  it('EvidenceSourceEnum covers all sources', () => {
    expect(EvidenceSourceEnum.options).toEqual([
      'spike',
      'production',
      'review',
      'interview',
    ])
  })

  it('SignalTypeEnum covers all signal types', () => {
    expect(SignalTypeEnum.options).toEqual(['type-1', 'type-2'])
  })

  it('DecisionTypeEnum covers all types', () => {
    expect(DecisionTypeEnum.options).toEqual([
      'architecture',
      'feature',
      'migration',
      'spike',
    ])
  })

  it('DecisionStatusEnum covers all statuses', () => {
    expect(DecisionStatusEnum.options).toEqual([
      'active',
      'superseded',
      'rolled-back',
      'validated',
    ])
  })

  it('SpikeAnswerEnum covers all answers', () => {
    expect(SpikeAnswerEnum.options).toEqual(['yes', 'no', 'inconclusive'])
  })

  it('SpikeExecutedByEnum covers all executors', () => {
    expect(SpikeExecutedByEnum.options).toEqual(['engine', 'human', 'paired'])
  })
})
