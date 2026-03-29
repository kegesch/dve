import { describe, test, expect, mock, afterEach } from 'bun:test'
import { OpenAIAgent } from '../../../infrastructure/agent/openai.agent'
import type { ConversationMessage } from '../../../application/ports'

const originalFetch = globalThis.fetch

function createMockFetch(responses: unknown[]) {
  let idx = 0
  return mock(async () => {
    const resp = responses[idx++]
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

const agent = new OpenAIAgent({
  model: 'gpt-4o',
  apiKey: 'test-key',
})

describe('OpenAIAgent', () => {
  test('emits text events from assistant response', async () => {
    globalThis.fetch = createMockFetch([
      {
        choices: [
          {
            message: { role: 'assistant', content: 'Hello from AI' },
            finish_reason: 'stop',
          },
        ],
      },
    ])

    const events = []
    for await (const event of agent.run({
      systemPrompt: 'You are helpful',
      messages: [],
      tools: [],
      maxIterations: 5,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text', content: 'Hello from AI' },
      { type: 'done', summary: 'Hello from AI' },
    ])
  })

  test('emits tool_call events from function calls', async () => {
    globalThis.fetch = createMockFetch([
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'queryGraph',
                    arguments: JSON.stringify({
                      queryType: 'invalidated',
                      tags: [],
                    }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      {
        choices: [
          {
            message: { role: 'assistant', content: 'Done' },
            finish_reason: 'stop',
          },
        ],
      },
    ])

    const events = []
    for await (const event of agent.run({
      systemPrompt: 'You are helpful',
      messages: [],
      tools: [],
      maxIterations: 5,
    })) {
      events.push(event)
    }

    expect(events[0]).toEqual({
      type: 'tool_call',
      tool: 'queryGraph',
      args: { queryType: 'invalidated', tags: [] },
      callId: 'call-1',
    })
    expect(events[events.length - 1].type).toBe('done')
  })

  test('emits transition event from transition tool call', async () => {
    globalThis.fetch = createMockFetch([
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'transition',
                    arguments: JSON.stringify({ target: 'DECOMPOSING' }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      {
        choices: [
          {
            message: { role: 'assistant', content: 'Moved' },
            finish_reason: 'stop',
          },
        ],
      },
    ])

    const events = []
    for await (const event of agent.run({
      systemPrompt: 'You are helpful',
      messages: [],
      tools: [],
      maxIterations: 5,
    })) {
      events.push(event)
    }

    expect(events[0]).toEqual({
      type: 'transition',
      target: 'DECOMPOSING',
    })
  })

  test('handles API errors gracefully', async () => {
    globalThis.fetch = mock(
      async () => new Response('Rate limit exceeded', { status: 429 }),
    ) as unknown as typeof fetch

    const events = []
    for await (const event of agent.run({
      systemPrompt: 'test',
      messages: [],
      tools: [],
      maxIterations: 5,
    })) {
      events.push(event)
    }

    expect(events[0].type).toBe('text')
    expect((events[0] as { content: string }).content).toContain('429')
    expect(events[1].type).toBe('done')
  })

  test('emits done when max iterations reached', async () => {
    const infiniteToolCall = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                function: {
                  name: 'queryGraph',
                  arguments: JSON.stringify({ queryType: 'invalidated' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }

    globalThis.fetch = createMockFetch(
      Array.from({ length: 10 }, () => infiniteToolCall),
    )

    const events = []
    for await (const event of agent.run({
      systemPrompt: 'test',
      messages: [],
      tools: [],
      maxIterations: 3,
    })) {
      events.push(event)
    }

    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents.length).toBe(1)
    expect((doneEvents[0] as { summary: string }).summary).toContain(
      'Max iterations',
    )
  })

  test('sends system prompt and messages to API', async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]

    const events = agent.run({
      systemPrompt: 'You are helpful',
      messages,
      tools: [],
      maxIterations: 5,
    })
    for await (const event of events) {
      void event
      break
    }

    expect(capturedBody).not.toBeNull()
    const msgs = capturedBody!.messages as Array<{
      role: string
      content: string | null
    }>
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toBe('You are helpful')
  })
})
