import type { Assumption, Spike } from '../../domain/types'

export type SpikeAction = 'approve' | 'modify' | 'drop' | 'defer'

export interface ProposedSpikeView {
  readonly spike: Spike
  readonly assumption: Assumption | null
}

export interface SpikeReviewContext {
  readonly proposedSpikes: readonly ProposedSpikeView[]
}

export interface SpikeReviewResult {
  readonly action: SpikeAction
  readonly spikeId: string
  readonly approvedBy?: string
  readonly modifications?: {
    readonly killingQuestion?: string
    readonly timeboxDays?: number
  }
  readonly dropReason?: string
  readonly acceptedBetAssumption?: Assumption
}

export function buildSpikeReviewContext(
  spikes: readonly Spike[],
  assumptions: readonly Assumption[],
): SpikeReviewContext {
  const assumptionMap = new Map(assumptions.map((a) => [a.id, a]))

  const proposedSpikes = spikes
    .filter((s) => s.scope.approved_by === 'pending')
    .map((spike) => ({
      spike,
      assumption: assumptionMap.get(spike.validates_assumption) ?? null,
    }))

  return { proposedSpikes }
}

export function approveSpike(spike: Spike, approvedBy: string): Spike {
  return {
    ...spike,
    scope: {
      ...spike.scope,
      approved_by: approvedBy,
    },
  }
}

export function modifySpike(
  spike: Spike,
  modifications: {
    readonly killingQuestion?: string
    readonly timeboxDays?: number
  },
): Spike {
  return {
    ...spike,
    killing_question: modifications.killingQuestion ?? spike.killing_question,
    scope: {
      ...spike.scope,
      timebox_days: modifications.timeboxDays ?? spike.scope.timebox_days,
    },
  }
}

export function dropSpike(
  spike: Spike,
  assumption: Assumption | null,
  reason: string,
): Assumption | null {
  if (!assumption) return null

  return {
    ...assumption,
    status: 'accepted-bet',
    evidence: {
      source: 'review',
      finding: `Spike ${spike.id} dropped: ${reason}. Assumption accepted as conscious bet.`,
    },
  }
}

export function deferSpike(spike: Spike): Spike {
  return {
    ...spike,
    scope: {
      ...spike.scope,
      approved_by: 'deferred',
    },
  }
}

export function formatSpikeForReview(view: ProposedSpikeView): string {
  const { spike, assumption } = view
  const lines: string[] = [
    `Spike: ${spike.id}`,
    `  Killing Question: ${spike.killing_question}`,
    `  Timebox: ${spike.scope.timebox_days} day(s)`,
    `  Validates: ${spike.validates_assumption}`,
  ]
  if (assumption) {
    lines.push(`  Assumption Statement: ${assumption.statement}`)
    lines.push(`  Assumption Status: ${assumption.status}`)
  }
  if (spike.parent_spike) {
    lines.push(`  Parent Spike: ${spike.parent_spike}`)
  }
  lines.push('  Actions: approve / modify / drop / defer')
  return lines.join('\n')
}

export function validateModifiedSpike(spike: Spike): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (spike.killing_question.trim().length === 0) {
    errors.push('Killing question must not be empty')
  }
  if (spike.scope.timebox_days < 1) {
    errors.push('Timebox must be at least 1 day')
  }
  if (spike.scope.timebox_days > 30) {
    errors.push('Timebox must not exceed 30 days')
  }
  return { valid: errors.length === 0, errors }
}
