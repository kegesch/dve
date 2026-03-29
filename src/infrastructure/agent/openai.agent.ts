import type {
  AgentPort,
  AgentEvent,
  AgentRunParams,
  ConversationMessage,
  ToolDefinition,
} from '../../application/ports'
import type { SessionState } from '../../domain/types'

export interface OpenAIAgentConfig {
  readonly model: string
  readonly apiKey: string
  readonly baseURL?: string
}

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly tool_calls?: readonly ToolCall[]
  readonly tool_call_id?: string
}

interface ToolCall {
  readonly id: string
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

interface Choice {
  readonly message: {
    readonly role: string
    readonly content: string | null
    readonly tool_calls?: readonly ToolCall[]
  }
  readonly finish_reason: string | null
}

function toToolDefs(tools: readonly ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters),
    },
  }))
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  try {
    const z = schema as { _def: Record<string, unknown> }
    const typeName = z._def?.typeName as string | undefined
    if (typeName === 'ZodObject') {
      const shape = (z._def.shape as () => Record<string, unknown>)?.() ?? {}
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val)
        const inner = val as { _def: { typeName: string; innerType?: unknown } }
        if (inner._def?.typeName !== 'ZodOptional') {
          required.push(key)
        }
      }
      return { type: 'object', properties, required }
    }
    if (typeName === 'ZodString') return { type: 'string' }
    if (typeName === 'ZodNumber') return { type: 'number' }
    if (typeName === 'ZodBoolean') return { type: 'boolean' }
    if (typeName === 'ZodArray') {
      const inner = z._def.type as unknown
      return { type: 'array', items: zodToJsonSchema(inner) }
    }
    if (typeName === 'ZodEnum') {
      const values = z._def.values as string[]
      return { type: 'string', enum: values }
    }
    if (typeName === 'ZodOptional') {
      return zodToJsonSchema(z._def.innerType as unknown)
    }
    if (typeName === 'ZodDefault') {
      return zodToJsonSchema(z._def.innerType as unknown)
    }
    return {}
  } catch {
    return {}
  }
}

function toMessages(
  messages: readonly ConversationMessage[],
  systemPrompt: string,
): ChatMessage[] {
  const result: ChatMessage[] = [{ role: 'system', content: systemPrompt }]

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      result.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      })
    } else if (msg.role === 'assistant' && msg.toolCallId) {
      result.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: [
          {
            id: msg.toolCallId,
            function: { name: msg.toolName ?? '', arguments: '{}' },
          },
        ],
      })
    } else {
      result.push({
        role: msg.role === 'system' ? 'user' : msg.role,
        content: msg.content,
      })
    }
  }

  return result
}

export class OpenAIAgent implements AgentPort {
  readonly id = 'openai'
  readonly name: string
  private readonly config: OpenAIAgentConfig

  constructor(config: OpenAIAgentConfig) {
    this.config = config
    this.name = config.model
  }

  async *run(params: AgentRunParams): AsyncGenerator<AgentEvent> {
    const url = `${this.config.baseURL ?? 'https://api.openai.com/v1'}/chat/completions`

    const messages = toMessages(params.messages, params.systemPrompt)
    const tools = params.tools.length > 0 ? toToolDefs(params.tools) : undefined

    for (let step = 0; step < params.maxIterations; step++) {
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        max_tokens: 4096,
      }
      if (tools && tools.length > 0) {
        body.tools = tools
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        yield {
          type: 'text',
          content: `[API Error ${response.status}]: ${errorText}`,
        }
        yield { type: 'done', summary: `API error: ${response.status}` }
        return
      }

      const data = (await response.json()) as { choices: Choice[] }
      const choice = data.choices?.[0]
      if (!choice) {
        yield { type: 'done', summary: 'No response from API' }
        return
      }

      const { message, finish_reason } = choice

      if (message.content) {
        yield { type: 'text', content: message.content }
        messages.push({ role: 'assistant', content: message.content })
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: message.tool_calls,
        })

        for (const tc of message.tool_calls) {
          const args = JSON.parse(tc.function.arguments) as Record<
            string,
            unknown
          >
          const toolName = tc.function.name

          if (toolName === 'transition') {
            const target = args.target as SessionState
            yield { type: 'transition', target }
          } else {
            yield {
              type: 'tool_call',
              tool: toolName,
              args,
              callId: tc.id,
            }
          }
        }
      }

      if (finish_reason === 'stop' || finish_reason === 'end_turn') {
        yield { type: 'done', summary: message.content ?? 'Completed' }
        return
      }
    }

    yield { type: 'done', summary: 'Max iterations reached' }
  }
}
