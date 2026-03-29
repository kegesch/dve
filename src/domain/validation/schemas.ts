import { z } from 'zod'

export const SessionStateEnum = z.enum([
  'SCOPING',
  'DECOMPOSING',
  'STRESS_TESTING',
  'SPIKE_PLANNING',
  'SPIKE_REVIEW',
  'SPIKE_EXECUTING',
  'COMMIT',
])

export const AssumptionClassEnum = z.enum([
  'technical',
  'environmental',
  'domain',
])

export const AssumptionStatusEnum = z.enum([
  'unvalidated',
  'validated',
  'invalidated',
  'accepted-bet',
])

export const EvidenceSourceEnum = z.enum([
  'spike',
  'production',
  'review',
  'interview',
])

export const SignalTypeEnum = z.enum(['type-1', 'type-2'])

export const DecisionTypeEnum = z.enum([
  'architecture',
  'feature',
  'migration',
  'spike',
])

export const DecisionStatusEnum = z.enum([
  'active',
  'superseded',
  'rolled-back',
  'validated',
])

export const SpikeAnswerEnum = z.enum(['yes', 'no', 'inconclusive'])

export const SpikeExecutedByEnum = z.enum(['engine', 'human', 'paired'])

const DecisionId = z.string().regex(/^DEC-\d{4}-\d{3}$/)
const AssumptionId = z.string().regex(/^ASM-\d{4}-\d{3}$/)
const SpikeId = z.string().regex(/^SPK-\d{4}-\d{3}$/)

export const AssumptionSchema = z.object({
  id: AssumptionId,
  class: AssumptionClassEnum,
  statement: z.string(),
  origin: z.object({
    decision: DecisionId,
  }),
  status: AssumptionStatusEnum,
  evidence: z
    .object({
      source: EvidenceSourceEnum,
      finding: z.string(),
    })
    .optional(),
  implication: z
    .object({
      summary: z.string(),
      signal_type: SignalTypeEnum,
    })
    .optional(),
  tags: z.array(z.string()),
  related_assumptions: z.array(AssumptionId),
})

export const DecisionSchema = z.object({
  id: DecisionId,
  type: DecisionTypeEnum,
  status: DecisionStatusEnum,
  goal: z.string(),
  assumptions: z.object({
    validated: z.array(AssumptionId),
    invalidated: z.array(AssumptionId),
    accepted_bets: z.array(AssumptionId),
  }),
  residue: z.string(),
  outcome: z
    .object({
      result: z.string().optional(),
      cost_weeks: z.number().optional(),
      superseded_by: DecisionId.optional(),
    })
    .optional(),
  commit_signatories: z.array(
    z.object({
      name: z.string(),
      signed_at: z.string(),
    }),
  ),
  arc42_sections_affected: z.array(z.string()),
  code_refs: z.array(z.string()),
})

export const SpikeSchema = z.object({
  id: SpikeId,
  validates_assumption: AssumptionId,
  parent_spike: SpikeId.optional(),
  killing_question: z.string(),
  scope: z.object({
    timebox_days: z.number(),
    isolated: z.literal(true),
    approved_by: z.string(),
  }),
  result: z
    .object({
      answer: SpikeAnswerEnum,
      finding: z.string(),
    })
    .optional(),
  executed_by: SpikeExecutedByEnum.optional(),
  reveals_assumptions: z.array(AssumptionId),
  triggers_spikes: z.array(SpikeId),
  artefact_path: z.string().optional(),
})

export const Arc42ContextSchema = z.object({
  sections: z.record(z.string(), z.string()),
})

export const StackContextSchema = z.object({
  technologies: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const GapsContextSchema = z.object({
  gaps: z.array(
    z.object({
      topic: z.string(),
      description: z.string(),
    }),
  ),
})

export const SessionStateSchema = z.object({
  state: SessionStateEnum,
  decision_id: DecisionId.optional(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
})

export type SessionState = z.infer<typeof SessionStateEnum>
export type AssumptionClass = z.infer<typeof AssumptionClassEnum>
export type AssumptionStatus = z.infer<typeof AssumptionStatusEnum>
export type EvidenceSource = z.infer<typeof EvidenceSourceEnum>
export type SignalType = z.infer<typeof SignalTypeEnum>
export type DecisionType = z.infer<typeof DecisionTypeEnum>
export type DecisionStatus = z.infer<typeof DecisionStatusEnum>
export type SpikeAnswer = z.infer<typeof SpikeAnswerEnum>
export type SpikeExecutedBy = z.infer<typeof SpikeExecutedByEnum>

export type Assumption = z.infer<typeof AssumptionSchema>
export type Decision = z.infer<typeof DecisionSchema>
export type Spike = z.infer<typeof SpikeSchema>
export type Arc42Context = z.infer<typeof Arc42ContextSchema>
export type StackContext = z.infer<typeof StackContextSchema>
export type GapsContext = z.infer<typeof GapsContextSchema>
export type SessionStateRecord = z.infer<typeof SessionStateSchema>
