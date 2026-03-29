import type { Assumption, Spike } from '../../domain/types'

export interface SpikePlanningContext {
  readonly highRiskAssumptions: readonly Assumption[]
  readonly existingSpikes: readonly Spike[]
}

export function buildSpikePlanningContext(
  rankedAssumptions: readonly import('./stress-testing').AssumptionIntersection[],
  existingSpikes: readonly Spike[],
  riskThreshold: number = 3,
): SpikePlanningContext {
  const highRiskAssumptions = rankedAssumptions
    .filter((i) => i.riskScore >= riskThreshold)
    .map((i) => i.assumption)

  return {
    highRiskAssumptions,
    existingSpikes,
  }
}

export function generateSpikeProposal(
  assumption: Assumption,
  killingQuestion: string,
  timeboxDays: number = 1,
): {
  validates_assumption: string
  killing_question: string
  timebox_days: number
} {
  return {
    validates_assumption: assumption.id,
    killing_question: killingQuestion,
    timebox_days: timeboxDays,
  }
}
