import type { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import type { Assumption, SessionStateRecord } from '../../domain/types'
import {
  findInvalidatedAssumptions,
  findUnvalidatedBets,
  getAssumptionsForDecision,
} from '../../domain/graph/queries'

export interface StressTestContext {
  readonly assumptions: readonly Assumption[]
  readonly invalidatedFromGraph: readonly Assumption[]
  readonly unvalidatedBets: readonly Assumption[]
  readonly intersections: readonly AssumptionIntersection[]
}

export interface AssumptionIntersection {
  readonly assumption: Assumption
  readonly relatedCount: number
  readonly riskScore: number
  readonly killingQuestion: string
}

export function buildStressTestContext(
  session: SessionStateRecord,
  graph: KnowledgeGraph,
  draftAssumptions: readonly Assumption[],
): StressTestContext {
  const decisionId = session.decision_id
  const existingAssumptions = decisionId
    ? getAssumptionsForDecision(graph, decisionId)
    : []

  const allAssumptions = [...existingAssumptions, ...draftAssumptions]
  const tags = (session.metadata.tags as string[]) ?? []
  const invalidatedFromGraph = findInvalidatedAssumptions(graph, tags)
  const unvalidatedBets = findUnvalidatedBets(graph, tags)

  const intersections = allAssumptions.map((assumption) => ({
    assumption,
    relatedCount: graph.getNeighbors(assumption.id).length,
    riskScore: 0,
    killingQuestion: '',
  }))

  return {
    assumptions: allAssumptions,
    invalidatedFromGraph,
    unvalidatedBets,
    intersections,
  }
}

export function rankAssumptions(
  intersections: readonly AssumptionIntersection[],
): AssumptionIntersection[] {
  return [...intersections]
    .map((i) => ({
      ...i,
      riskScore: i.relatedCount * 2 + (i.killingQuestion ? 3 : 0),
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
}
