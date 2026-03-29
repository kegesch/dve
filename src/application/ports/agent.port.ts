import type { z } from 'zod'
import type { SessionState } from '../../domain/types'

export interface ConversationMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly toolCallId?: string
  readonly toolName?: string
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: z.ZodType
}

export type AgentEvent =
  | {
      readonly type: 'tool_call'
      readonly tool: string
      readonly args: Record<string, unknown>
      readonly callId: string
    }
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'transition'; readonly target: SessionState }
  | { readonly type: 'done'; readonly summary: string }

export interface AgentRunParams {
  readonly systemPrompt: string
  readonly messages: readonly ConversationMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly maxIterations: number
}

export interface AgentPort {
  readonly id: string
  readonly name: string
  run(params: AgentRunParams): AsyncGenerator<AgentEvent>
}
