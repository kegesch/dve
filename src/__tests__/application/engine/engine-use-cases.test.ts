import { describe, test, expect } from 'bun:test'
import type {
  Assumption,
  Decision,
  Spike,
  SessionStateRecord,
} from '../../../domain/types'
import { KnowledgeGraph } from '../../../domain/graph/knowledge-graph'
import { buildDecompositionContext } from '../../../application/engine/decomposition'
import {
  buildStressTestContext,
  rankAssumptions,
} from '../../../application/engine/stress-testing'
import {
  buildSpikePlanningContext,
  generateSpikeProposal,
} from '../../../application/engine/spike-planning'
import {
  buildCommitGateContext,
  generateCommitBrief,
} from '../../../application/engine/commit-gate'

const sampleAssumption: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'Test assumption',
  origin: { decision: 'DEC-2026-001' },
  status: 'unvalidated',
  tags: ['auth', 'security'],
  related_assumptions: [],
}

const sampleDecision: Decision = {
  id: 'DEC-2026-001',
  type: 'architecture',
  status: 'active',
  goal: 'Build auth system',
  assumptions: { validated: [], invalidated: [], accepted_bets: [] },
  residue: '',
  commit_signatories: [],
  arc42_sections_affected: [],
  code_refs: [],
}

function makeSession(
  overrides: Partial<SessionStateRecord> = {},
): SessionStateRecord {
  return {
    state: 'SCOPING',
    metadata: { goal: 'Build auth system', tags: ['auth'] },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('Decomposition', () => {
  test('builds context with goal and relevant assumptions', () => {
    const graph = new KnowledgeGraph()
    graph.addNode(sampleAssumption)
    graph.addNode(sampleDecision)

    const session = makeSession({ state: 'DECOMPOSING' })
    const context = buildDecompositionContext(session, graph, {
      arc42: { sections: { context: 'Test context' } },
      stack: { technologies: ['TypeScript', 'Bun'] },
    })

    expect(context.goal).toBe('Build auth system')
    expect(context.existingDecisions).toBe(1)
    expect(context.arc42).not.toBeNull()
    expect(context.stack).not.toBeNull()
    expect(context.stack!.technologies).toEqual(['TypeScript', 'Bun'])
  })

  test('handles missing context gracefully', () => {
    const graph = new KnowledgeGraph()
    const session = makeSession({ state: 'DECOMPOSING' })

    const context = buildDecompositionContext(session, graph, {
      arc42: null,
      stack: null,
    })

    expect(context.arc42).toBeNull()
    expect(context.stack).toBeNull()
    expect(context.relevantAssumptions).toEqual([])
    expect(context.existingDecisions).toBe(0)
  })
})

describe('Stress Testing', () => {
  test('builds context with assumptions and invalidated items', () => {
    const graph = new KnowledgeGraph()
    const invalidated: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-002',
      status: 'invalidated',
      tags: ['auth'],
    }
    graph.addNode(sampleAssumption)
    graph.addNode(invalidated)
    graph.addNode(sampleDecision)

    const session = makeSession({
      state: 'STRESS_TESTING',
      decision_id: 'DEC-2026-001',
    })
    const context = buildStressTestContext(session, graph, [])

    expect(context.assumptions.length).toBeGreaterThanOrEqual(0)
    expect(context.invalidatedFromGraph).toHaveLength(1)
    expect(context.intersections).toBeDefined()
  })

  test('rankAssumptions sorts by risk score descending', () => {
    const intersections = [
      {
        assumption: sampleAssumption,
        relatedCount: 1,
        riskScore: 0,
        killingQuestion: '',
      },
      {
        assumption: { ...sampleAssumption, id: 'ASM-2026-010' },
        relatedCount: 5,
        riskScore: 0,
        killingQuestion: 'Does this work?',
      },
    ]

    const ranked = rankAssumptions(intersections)

    expect(ranked[0].assumption.id).toBe('ASM-2026-010')
    expect(ranked[0].riskScore).toBeGreaterThan(ranked[1].riskScore)
  })

  test('includes draft assumptions in context', () => {
    const graph = new KnowledgeGraph()
    graph.addNode(sampleDecision)

    const draft: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-099',
    }

    const session = makeSession({
      state: 'STRESS_TESTING',
      decision_id: 'DEC-2026-001',
    })
    const context = buildStressTestContext(session, graph, [draft])

    expect(context.assumptions).toContainEqual(draft)
  })
})

describe('Spike Planning', () => {
  test('filters high risk assumptions above threshold', () => {
    const lowRisk: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-001',
    }
    const highRisk: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-002',
    }

    const intersections = [
      {
        assumption: lowRisk,
        relatedCount: 0,
        riskScore: 1,
        killingQuestion: '',
      },
      {
        assumption: highRisk,
        relatedCount: 5,
        riskScore: 8,
        killingQuestion: 'Does it work?',
      },
    ]

    const ctx = buildSpikePlanningContext(intersections, [], 3)

    expect(ctx.highRiskAssumptions).toHaveLength(1)
    expect(ctx.highRiskAssumptions[0].id).toBe('ASM-2026-002')
  })

  test('generateSpikeProposal creates correct structure', () => {
    const proposal = generateSpikeProposal(sampleAssumption, 'Is it secure?', 2)

    expect(proposal.validates_assumption).toBe('ASM-2026-001')
    expect(proposal.killing_question).toBe('Is it secure?')
    expect(proposal.timebox_days).toBe(2)
  })

  test('defaults timebox to 1 day', () => {
    const proposal = generateSpikeProposal(sampleAssumption, 'Test?')
    expect(proposal.timebox_days).toBe(1)
  })
})

describe('Commit Gate', () => {
  test('builds context with categorized assumptions', () => {
    const graph = new KnowledgeGraph()
    const validated: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-001',
      status: 'validated',
    }
    const invalidated: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-002',
      status: 'invalidated',
    }
    const bet: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-003',
      status: 'accepted-bet',
    }
    graph.addNode(sampleDecision)

    const session = makeSession({
      state: 'COMMIT',
      decision_id: 'DEC-2026-001',
      metadata: {
        goal: 'Build auth',
        decisionType: 'architecture',
        residue: 'Some residue',
        signatories: [{ name: 'Alice', signed_at: '2026-01-01' }],
      },
    })

    const ctx = buildCommitGateContext(session, graph, {
      assumptions: [validated, invalidated, bet],
      spikes: [],
    })

    expect(ctx.validatedAssumptions).toHaveLength(1)
    expect(ctx.invalidatedAssumptions).toHaveLength(1)
    expect(ctx.acceptedBets).toHaveLength(1)
    expect(ctx.decision.goal).toBe('Build auth')
    expect(ctx.signatories).toHaveLength(1)
  })

  test('generateCommitBrief produces correct summary', () => {
    const spike: Spike = {
      id: 'SPK-2026-001',
      validates_assumption: 'ASM-2026-001',
      killing_question: 'Test?',
      scope: { timebox_days: 1, isolated: true, approved_by: 'Alice' },
      reveals_assumptions: [],
      triggers_spikes: [],
      result: { answer: 'yes', finding: 'It works' },
    }

    const ctx = {
      decision: { goal: 'Build auth', type: 'architecture', residue: 'None' },
      validatedAssumptions: [sampleAssumption],
      invalidatedAssumptions: [],
      acceptedBets: [],
      spikes: [spike],
      signatories: [{ name: 'Alice', signed_at: '2026-01-01' }],
    }

    const brief = generateCommitBrief(ctx)

    expect(brief.summary).toContain('Build auth')
    expect(brief.validatedCount).toBe(1)
    expect(brief.invalidatedCount).toBe(0)
    expect(brief.spikeResults).toHaveLength(1)
    expect(brief.spikeResults[0].answer).toBe('yes')
    expect(brief.signatories).toHaveLength(1)
  })

  test('handles empty drafts', () => {
    const graph = new KnowledgeGraph()
    const session = makeSession({ state: 'COMMIT' })

    const ctx = buildCommitGateContext(session, graph, {
      assumptions: [],
      spikes: [],
    })

    expect(ctx.validatedAssumptions).toEqual([])
    expect(ctx.invalidatedAssumptions).toEqual([])
    expect(ctx.acceptedBets).toEqual([])
  })
})
