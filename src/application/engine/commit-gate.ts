import type { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import type { Assumption, SessionStateRecord, Spike } from '../../domain/types'
import { getAssumptionsForDecision } from '../../domain/graph/queries'

export interface CommitGateContext {
  readonly decision: {
    readonly goal: string
    readonly type: string
    readonly residue: string
  }
  readonly validatedAssumptions: readonly Assumption[]
  readonly invalidatedAssumptions: readonly Assumption[]
  readonly acceptedBets: readonly Assumption[]
  readonly spikes: readonly Spike[]
  readonly signatories: readonly { name: string; signed_at: string }[]
}

export interface CommitBrief {
  readonly summary: string
  readonly validatedCount: number
  readonly invalidatedCount: number
  readonly acceptedBetCount: number
  readonly spikeResults: readonly {
    spikeId: string
    answer: string
    finding: string
  }[]
  readonly residue: string
  readonly signatories: readonly { name: string; signed_at: string }[]
}

export function buildCommitGateContext(
  session: SessionStateRecord,
  graph: KnowledgeGraph,
  drafts: { assumptions: readonly Assumption[]; spikes: readonly Spike[] },
): CommitGateContext {
  const goal = session.metadata.goal as string
  const decisionType =
    (session.metadata.decisionType as string) ?? 'architecture'
  const residue = (session.metadata.residue as string) ?? ''
  const signatories =
    (session.metadata.signatories as { name: string; signed_at: string }[]) ??
    []

  const decisionId = session.decision_id
  const existingAssumptions = decisionId
    ? getAssumptionsForDecision(graph, decisionId)
    : []

  const allAssumptions = [...existingAssumptions, ...drafts.assumptions]

  const validatedAssumptions = allAssumptions.filter(
    (a) => a.status === 'validated',
  )
  const invalidatedAssumptions = allAssumptions.filter(
    (a) => a.status === 'invalidated',
  )
  const acceptedBets = allAssumptions.filter((a) => a.status === 'accepted-bet')

  return {
    decision: { goal, type: decisionType, residue },
    validatedAssumptions,
    invalidatedAssumptions,
    acceptedBets,
    spikes: drafts.spikes,
    signatories,
  }
}

export function generateCommitBrief(context: CommitGateContext): CommitBrief {
  return {
    summary: `Decision: ${context.decision.goal}`,
    validatedCount: context.validatedAssumptions.length,
    invalidatedCount: context.invalidatedAssumptions.length,
    acceptedBetCount: context.acceptedBets.length,
    spikeResults: context.spikes
      .filter((s) => s.result)
      .map((s) => ({
        spikeId: s.id,
        answer: s.result!.answer,
        finding: s.result!.finding,
      })),
    residue: context.decision.residue,
    signatories: context.signatories,
  }
}
