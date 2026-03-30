import { describe, test, expect, mock } from 'bun:test'
import type {
  AgentPort,
  AgentEvent,
  HumanIOPort,
  PresenterPort,
  ToolPort,
  ToolResult,
} from '../../../application/ports'
import { Pipeline } from '../../../application/engine/pipeline'
import { buildSystemPrompt } from '../../../application/engine/prompt-builder'
import {
  getToolsForState,
  isToolAllowed,
  ALL_TOOLS,
} from '../../../application/engine/tools'

function createMockPresenter(): PresenterPort {
  return {
    display: mock(() => {}),
    displayError: mock(() => {}),
    displayTable: mock(() => {}),
    displayProgress: mock(() => {}),
  }
}

function createMockHumanIO(responses: string[] = ['yes']): HumanIOPort {
  let idx = 0
  const askFn = mock(async () => responses[idx++] ?? 'default')
  const confirmFn = mock(async () => true)
  const selectFn = mock(async () => 'option')
  return {
    ask: askFn as HumanIOPort['ask'],
    confirm: confirmFn as HumanIOPort['confirm'],
    select: selectFn as HumanIOPort['select'],
  }
}

function createMockTool(name: string, result?: ToolResult): ToolPort {
  return {
    name,
    execute: mock(async () => result ?? { success: true, data: {} }),
  }
}

function createMockAgent(eventMap?: Map<string, AgentEvent[]>): AgentPort {
  let callCount = 0
  const self: AgentPort = {
    id: 'mock-agent',
    name: 'Mock Agent',
    run: mock(async function* (this: AgentPort) {
      callCount++
      const key = `call-${callCount}`
      const events = eventMap?.get(key) ?? [
        { type: 'done' as const, summary: 'complete' },
      ]
      for (const event of events) {
        yield event
      }
    }),
  }
  return self
}

describe('Pipeline', () => {
  describe('text events', () => {
    test('displays text events from agent', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              { type: 'text', content: 'Hello from agent' },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('SCOPING')
      expect(presenter.display).toHaveBeenCalledWith('Hello from agent')
    })
  })

  describe('tool dispatch', () => {
    test('dispatches allowed tool calls to registered tools', async () => {
      const queryGraphTool = createMockTool('queryGraph', {
        success: true,
        data: { assumptions: [] },
      })
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              {
                type: 'tool_call',
                tool: 'queryGraph',
                args: { queryType: 'invalidated', tags: [] },
                callId: 'tc-1',
              },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [queryGraphTool],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('SCOPING')
      expect(queryGraphTool.execute).toHaveBeenCalledWith({
        queryType: 'invalidated',
        tags: [],
      })
    })

    test('rejects tool calls not allowed in current state', async () => {
      const writeAssumptionTool = createMockTool('writeAssumption')
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              {
                type: 'tool_call',
                tool: 'writeAssumption',
                args: { statement: 'test' },
                callId: 'tc-1',
              },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [writeAssumptionTool],
        presenter,
        humanIO: createMockHumanIO(),
      })

      await pipeline.run('SCOPING', { assumptions: 0, approvedSpikes: 0 })

      expect(writeAssumptionTool.execute).not.toHaveBeenCalled()
    })

    test('handles askHuman tool by delegating to HumanIOPort', async () => {
      const presenter = createMockPresenter()
      const humanIO = createMockHumanIO(['my answer'])
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              {
                type: 'tool_call',
                tool: 'askHuman',
                args: { question: 'What do you think?' },
                callId: 'tc-1',
              },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO,
      })

      await pipeline.run('SCOPING', { assumptions: 0, approvedSpikes: 0 })

      expect(humanIO.ask).toHaveBeenCalledWith('What do you think?')
    })

    test('returns error for unregistered tool', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              {
                type: 'tool_call',
                tool: 'queryGraph',
                args: { queryType: 'invalidated' },
                callId: 'tc-1',
              },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('SCOPING')
      const toolMsg = result.messages.find(
        (m) => m.role === 'tool' && m.content.includes('not registered'),
      )
      expect(toolMsg).toBeDefined()
    })
  })

  describe('transitions', () => {
    test('advances state on valid transition', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          ['call-1', [{ type: 'transition', target: 'DECOMPOSING' }]],
          ['call-2', [{ type: 'done', summary: 'done' }]],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('DECOMPOSING')
      expect(presenter.displayProgress).toHaveBeenCalledWith('DECOMPOSING')
    })

    test('rejects illegal transition and reports error to agent', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              { type: 'transition', target: 'SPIKE_EXECUTING' },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('SCOPING')
      expect(presenter.displayError).toHaveBeenCalled()
    })

    test('rejects transition when prerequisites not met', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          [
            'call-1',
            [
              { type: 'transition', target: 'STRESS_TESTING' },
              { type: 'done', summary: 'done' },
            ],
          ],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('DECOMPOSING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('DECOMPOSING')
      expect(presenter.displayError).toHaveBeenCalled()
    })

    test('allows transition when prerequisites are met', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          ['call-1', [{ type: 'transition', target: 'STRESS_TESTING' }]],
          ['call-2', [{ type: 'done', summary: 'done' }]],
        ]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('DECOMPOSING', {
        assumptions: 2,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('STRESS_TESTING')
    })
  })

  describe('done event', () => {
    test('completes pipeline on done event', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([['call-1', [{ type: 'done', summary: 'All done' }]]]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.finalState).toBe('SCOPING')
      expect(result.completed).toBe(false)
      expect(result.iterations).toBe(1)
    })
  })

  describe('max iteration guard', () => {
    test('stops pipeline when max iterations exceeded without transition or done', async () => {
      let callIdx = 0
      const presenter = createMockPresenter()
      const agent: AgentPort = {
        id: 'mock-agent',
        name: 'Mock Agent',
        run: mock(async function* () {
          callIdx++
          yield { type: 'text', content: `text ${callIdx}` } as AgentEvent
        }),
      }

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
        config: { maxPipelineLoops: 3 },
      })

      const result = await pipeline.run('SCOPING', {
        assumptions: 0,
        approvedSpikes: 0,
      })

      expect(result.completed).toBe(false)
      expect(result.iterations).toBe(3)
      expect(presenter.displayError).toHaveBeenCalled()
    })
  })

  describe('onStateChange callback', () => {
    test('calls onStateChange when state transitions', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([
          ['call-1', [{ type: 'transition', target: 'DECOMPOSING' }]],
          ['call-2', [{ type: 'done', summary: 'done' }]],
        ]),
      )
      const stateChanges: string[] = []
      const onStateChange = mock(async (state: string) => {
        stateChanges.push(state)
      })

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
        onStateChange,
      })

      await pipeline.run('SCOPING', { assumptions: 0, approvedSpikes: 0 })

      expect(onStateChange).toHaveBeenCalledTimes(1)
      expect(stateChanges).toEqual(['DECOMPOSING'])
    })
  })

  describe('COMMIT state', () => {
    test('returns completed=true when reaching COMMIT', async () => {
      const presenter = createMockPresenter()
      const agent = createMockAgent(
        new Map([['call-1', [{ type: 'transition', target: 'COMMIT' }]]]),
      )

      const pipeline = new Pipeline({
        agent,
        tools: [],
        presenter,
        humanIO: createMockHumanIO(),
      })

      const result = await pipeline.run('SPIKE_EXECUTING', {
        assumptions: 1,
        approvedSpikes: 1,
      })

      expect(result.completed).toBe(true)
      expect(result.finalState).toBe('COMMIT')
    })
  })
})

describe('buildSystemPrompt', () => {
  test('includes current state in prompt', () => {
    const context: import('../../../application/engine/types').PipelineContext =
      {
        currentState: 'SCOPING',
        visitCounts: new Map(),
        messages: [],
        iteration: 1,
      }

    const prompt = buildSystemPrompt('SCOPING', context)

    expect(prompt).toContain('SCOPING')
    expect(prompt).toContain('DECOMPOSING')
    expect(prompt).toContain('Iteration: 1')
  })

  test('shows terminal state for COMMIT', () => {
    const context: import('../../../application/engine/types').PipelineContext =
      {
        currentState: 'COMMIT',
        visitCounts: new Map(),
        messages: [],
        iteration: 1,
      }

    const prompt = buildSystemPrompt('COMMIT', context)

    expect(prompt).toContain('None (terminal state)')
  })

  test('includes state description', () => {
    const context: import('../../../application/engine/types').PipelineContext =
      {
        currentState: 'DECOMPOSING',
        visitCounts: new Map(),
        messages: [],
        iteration: 1,
      }

    const prompt = buildSystemPrompt('DECOMPOSING', context)

    expect(prompt).toContain('Separate requirements from assumptions')
  })
})

describe('tools', () => {
  test('getToolsForState returns only allowed tools', () => {
    const scopingTools = getToolsForState('SCOPING')
    const names = scopingTools.map((t) => t.name)

    expect(names).toContain('queryGraph')
    expect(names).toContain('askHuman')
    expect(names).toContain('readFile')
    expect(names).toContain('transition')
    expect(names).not.toContain('writeAssumption')
    expect(names).not.toContain('proposeSpike')
  })

  test('DECOMPOSING has writeAssumption', () => {
    const tools = getToolsForState('DECOMPOSING')
    const names = tools.map((t) => t.name)

    expect(names).toContain('writeAssumption')
  })

  test('SPIKE_REVIEW has approve/modify/drop/defer tools', () => {
    const tools = getToolsForState('SPIKE_REVIEW')
    const names = tools.map((t) => t.name)

    expect(names).toContain('approveSpike')
    expect(names).toContain('modifySpike')
    expect(names).toContain('dropSpike')
    expect(names).toContain('deferSpike')
  })

  test('isToolAllowed returns true for allowed tool', () => {
    expect(isToolAllowed('SCOPING', 'queryGraph')).toBe(true)
  })

  test('isToolAllowed returns false for disallowed tool', () => {
    expect(isToolAllowed('SCOPING', 'writeAssumption')).toBe(false)
  })

  test('ALL_TOOLS includes all expected tools', () => {
    const names = ALL_TOOLS.map((t) => t.name)

    expect(names).toContain('queryGraph')
    expect(names).toContain('askHuman')
    expect(names).toContain('writeAssumption')
    expect(names).toContain('proposeSpike')
    expect(names).toContain('approveSpike')
    expect(names).toContain('modifySpike')
    expect(names).toContain('dropSpike')
    expect(names).toContain('deferSpike')
    expect(names).toContain('transition')
    expect(names).toContain('updateRiskRanking')
    expect(names).toContain('executeSpike')
    expect(names).toContain('generateBrief')
    expect(names).toContain('writeRecord')
    expect(names).toContain('readFile')
  })
})
