import { describe, test, expect, mock } from 'bun:test'
import { KnowledgeGraph } from '../../../domain/graph/knowledge-graph'
import type { Assumption, Decision } from '../../../domain/types'
import {
  createQueryGraphTool,
  createReadFileTool,
  createAskHumanTool,
  createWriteAssumptionTool,
  createProposeSpikeTool,
  createExecuteSpikeTool,
  ToolDispatcher,
} from '../../../infrastructure/agent/tool-dispatcher'
import type {
  ToolPort,
  HumanIOPort,
  GraphStorePort,
  SpikeRunnerPort,
} from '../../../application/ports'

const sampleAssumption: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'Test assumption',
  origin: { decision: 'DEC-2026-001' },
  status: 'invalidated',
  tags: ['auth'],
  related_assumptions: [],
}

const sampleDecision: Decision = {
  id: 'DEC-2026-001',
  type: 'architecture',
  status: 'active',
  goal: 'Test',
  assumptions: {
    validated: [],
    invalidated: ['ASM-2026-001'],
    accepted_bets: [],
  },
  residue: '',
  commit_signatories: [],
  arc42_sections_affected: [],
  code_refs: [],
}

describe('createQueryGraphTool', () => {
  test('finds invalidated assumptions', async () => {
    const graph = new KnowledgeGraph()
    graph.addNode(sampleAssumption)
    graph.addNode(sampleDecision)

    const tool = createQueryGraphTool(graph)
    const result = await tool.execute({ queryType: 'invalidated', tags: [] })

    expect(result.success).toBe(true)
    expect(result.data as Assumption[]).toHaveLength(1)
  })

  test('finds unvalidated bets', async () => {
    const bet: Assumption = {
      ...sampleAssumption,
      id: 'ASM-2026-002',
      status: 'accepted-bet',
    }
    const graph = new KnowledgeGraph()
    graph.addNode(bet)
    graph.addNode(sampleDecision)

    const tool = createQueryGraphTool(graph)
    const result = await tool.execute({
      queryType: 'unvalidated_bets',
      tags: [],
    })

    expect(result.success).toBe(true)
    expect(result.data as Assumption[]).toHaveLength(1)
  })

  test('returns error for invalid args', async () => {
    const tool = createQueryGraphTool(new KnowledgeGraph())
    const result = await tool.execute({})

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('returns error when id missing for related query', async () => {
    const tool = createQueryGraphTool(new KnowledgeGraph())
    const result = await tool.execute({ queryType: 'related' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('id is required')
  })
})

describe('createReadFileTool', () => {
  test('prevents path traversal', async () => {
    const tool = createReadFileTool('/safe/dir')
    const result = await tool.execute({ path: '../../etc/passwd' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('traversal')
  })
})

describe('createAskHumanTool', () => {
  test('delegates to HumanIOPort', async () => {
    const askFn = mock(async () => 'my response')
    const confirmFn = mock(async () => true)
    const selectFn = mock(async () => 'opt')
    const humanIO: HumanIOPort = {
      ask: askFn as HumanIOPort['ask'],
      confirm: confirmFn as HumanIOPort['confirm'],
      select: selectFn as HumanIOPort['select'],
    }

    const tool = createAskHumanTool(humanIO)
    const result = await tool.execute({ question: 'What?' })

    expect(result.success).toBe(true)
    expect((result.data as { answer: string }).answer).toBe('my response')
  })

  test('handles human IO error', async () => {
    const askFn = mock(async () => {
      throw new Error('User cancelled')
    })
    const confirmFn = mock(async () => true)
    const selectFn = mock(async () => 'opt')
    const humanIO: HumanIOPort = {
      ask: askFn as HumanIOPort['ask'],
      confirm: confirmFn as HumanIOPort['confirm'],
      select: selectFn as HumanIOPort['select'],
    }

    const tool = createAskHumanTool(humanIO)
    const result = await tool.execute({ question: 'What?' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('User cancelled')
  })
})

describe('createWriteAssumptionTool', () => {
  test('creates assumption with minted ID', async () => {
    const graphStore: GraphStorePort = {
      readAssumptions: mock(async () => []),
      readRecords: mock(async () => []),
      readSpikes: mock(async () => []),
      writeAssumption: mock(async () => {}),
      writeRecord: mock(async () => {}),
      writeSpike: mock(async () => {}),
      readContext: mock(async () => ({ arc42: null, stack: null, gaps: null })),
      writeContext: mock(async () => {}),
    }
    const savedDrafts: unknown[] = []
    const saveDraft = mock(async (record: unknown) => {
      savedDrafts.push(record)
    })
    const mintId = mock(
      (ids: readonly string[]) =>
        `ASM-2026-${(ids.length + 1).toString().padStart(3, '0')}`,
    )

    const tool = createWriteAssumptionTool(graphStore, saveDraft, mintId)
    const result = await tool.execute({
      assumptionClass: 'technical',
      statement: 'We need OAuth2',
      decisionId: 'DEC-2026-001',
      tags: ['auth'],
    })

    expect(result.success).toBe(true)
    expect((result.data as { id: string }).id).toBe('ASM-2026-001')
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  test('validates arguments', async () => {
    const tool = createWriteAssumptionTool(
      {} as GraphStorePort,
      async () => {},
      () => 'ASM-2026-001',
    )
    const result = await tool.execute({})

    expect(result.success).toBe(false)
  })
})

describe('createProposeSpikeTool', () => {
  test('creates spike with minted ID', async () => {
    const graphStore: GraphStorePort = {
      readAssumptions: mock(async () => []),
      readRecords: mock(async () => []),
      readSpikes: mock(async () => []),
      writeAssumption: mock(async () => {}),
      writeRecord: mock(async () => {}),
      writeSpike: mock(async () => {}),
      readContext: mock(async () => ({ arc42: null, stack: null, gaps: null })),
      writeContext: mock(async () => {}),
    }
    const saveDraft = mock(async () => {})
    const mintId = mock(() => 'SPK-2026-001')

    const tool = createProposeSpikeTool(graphStore, saveDraft, mintId)
    const result = await tool.execute({
      validatesAssumption: 'ASM-2026-001',
      killingQuestion: 'Does it work?',
      timeboxDays: 2,
    })

    expect(result.success).toBe(true)
    expect((result.data as { id: string }).id).toBe('SPK-2026-001')
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })
})

describe('createExecuteSpikeTool', () => {
  test('delegates to spike runner', async () => {
    const runner: SpikeRunnerPort = {
      execute: mock(async () => ({
        answer: 'yes' as const,
        finding: 'It works',
        exitCode: 0,
        stdout: '',
        stderr: '',
      })),
    }

    const tool = createExecuteSpikeTool(runner)
    const result = await tool.execute({
      spikeId: 'SPK-2026-001',
      code: 'console.log("test")',
    })

    expect(result.success).toBe(true)
    expect(runner.execute).toHaveBeenCalledTimes(1)
  })

  test('handles spike runner error', async () => {
    const runner: SpikeRunnerPort = {
      execute: mock(async () => {
        throw new Error('Docker not available')
      }),
    }

    const tool = createExecuteSpikeTool(runner)
    const result = await tool.execute({
      spikeId: 'SPK-2026-001',
      code: 'console.log("test")',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Docker')
  })
})

describe('ToolDispatcher', () => {
  test('dispatches to registered tool', async () => {
    const tool: ToolPort = {
      name: 'testTool',
      execute: mock(async () => ({ success: true, data: 'hello' })),
    }

    const dispatcher = new ToolDispatcher([tool])
    const result = await dispatcher.dispatch('testTool', {})

    expect(result.success).toBe(true)
  })

  test('returns error for unknown tool', async () => {
    const dispatcher = new ToolDispatcher([])
    const result = await dispatcher.dispatch('unknown', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })

  test('lists registered tools', () => {
    const tools: ToolPort[] = [
      { name: 'queryGraph', execute: async () => ({ success: true }) },
      { name: 'askHuman', execute: async () => ({ success: true }) },
    ]

    const dispatcher = new ToolDispatcher(tools)
    expect(dispatcher.getRegisteredTools()).toEqual(['queryGraph', 'askHuman'])
  })
})
