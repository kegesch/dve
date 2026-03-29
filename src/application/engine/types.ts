import type { SessionState } from '../../domain/types'
import type { ConversationMessage, ToolDefinition } from '../ports'

export interface PipelineConfig {
  readonly maxAgentIterations: number
  readonly maxPipelineLoops: number
  readonly loopVisitThreshold: number
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxAgentIterations: 50,
  maxPipelineLoops: 100,
  loopVisitThreshold: 3,
}

export interface PipelineContext {
  readonly currentState: SessionState
  readonly visitCounts: ReadonlyMap<SessionState, number>
  readonly messages: ConversationMessage[]
  readonly iteration: number
}

export interface StateTools {
  readonly definitions: readonly ToolDefinition[]
  readonly dispatch: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>
}

export type PromptBuilder = (
  state: SessionState,
  context: PipelineContext,
) => string

export interface PipelineResult {
  readonly completed: boolean
  readonly finalState: SessionState
  readonly iterations: number
  readonly messages: readonly ConversationMessage[]
}
