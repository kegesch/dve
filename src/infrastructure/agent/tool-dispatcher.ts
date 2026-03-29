import { resolve, relative } from 'node:path'
import { readFile as fsReadFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type {
  ToolPort,
  ToolResult,
  GraphStorePort,
  HumanIOPort,
} from '../../application/ports'
import type { SpikeRunnerPort } from '../../application/ports'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import {
  findInvalidatedAssumptions,
  findUnvalidatedBets,
  findRelatedAssumptions,
  getImplicationChain,
  getAssumptionsForDecision,
  findRelevantAssumptions,
} from '../../domain/graph/queries'

const QueryGraphArgs = z.object({
  queryType: z.enum([
    'invalidated',
    'unvalidated_bets',
    'related',
    'implication_chain',
    'assumptions_for_decision',
    'relevant',
  ]),
  id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  assumptionClass: z.enum(['technical', 'environmental', 'domain']).optional(),
})

export function createQueryGraphTool(graph: KnowledgeGraph): ToolPort {
  return {
    name: 'queryGraph',
    async execute(args): Promise<ToolResult> {
      const parsed = QueryGraphArgs.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }
      const { queryType, id, tags = [], assumptionClass } = parsed.data

      try {
        let data: unknown
        switch (queryType) {
          case 'invalidated':
            data = findInvalidatedAssumptions(graph, tags)
            break
          case 'unvalidated_bets':
            data = findUnvalidatedBets(graph, tags)
            break
          case 'related':
            if (!id)
              return {
                success: false,
                error: 'id is required for related query',
              }
            data = findRelatedAssumptions(graph, id)
            break
          case 'implication_chain':
            if (!id)
              return {
                success: false,
                error: 'id is required for implication_chain query',
              }
            data = getImplicationChain(graph, id)
            break
          case 'assumptions_for_decision':
            if (!id)
              return {
                success: false,
                error: 'id is required for assumptions_for_decision query',
              }
            data = getAssumptionsForDecision(graph, id)
            break
          case 'relevant':
            data = findRelevantAssumptions(graph, tags, assumptionClass)
            break
        }
        return { success: true, data }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Query failed',
        }
      }
    },
  }
}

const ReadFileArgs = z.object({
  path: z.string(),
})

export function createReadFileTool(repoRoot: string): ToolPort {
  return {
    name: 'readFile',
    async execute(args): Promise<ToolResult> {
      const parsed = ReadFileArgs.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      const resolved = resolve(repoRoot, parsed.data.path)
      const rel = relative(repoRoot, resolved)
      if (rel.startsWith('..') || resolve(repoRoot, rel) !== resolved) {
        return { success: false, error: 'Path traversal not allowed' }
      }

      if (!existsSync(resolved)) {
        return { success: false, error: `File not found: ${parsed.data.path}` }
      }

      try {
        const content = await fsReadFile(resolved, 'utf-8')
        return { success: true, data: { content } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Read failed',
        }
      }
    },
  }
}

export function createAskHumanTool(humanIO: HumanIOPort): ToolPort {
  const Args = z.object({ question: z.string() })
  return {
    name: 'askHuman',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }
      try {
        const answer = await humanIO.ask(parsed.data.question)
        return { success: true, data: { answer } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to ask human',
        }
      }
    },
  }
}

const WriteAssumptionArgs = z.object({
  assumptionClass: z.enum(['technical', 'environmental', 'domain']),
  statement: z.string(),
  decisionId: z.string(),
  status: z
    .enum(['unvalidated', 'validated', 'invalidated', 'accepted-bet'])
    .default('unvalidated'),
  tags: z.array(z.string()).default([]),
  relatedAssumptions: z.array(z.string()).default([]),
})

export function createWriteAssumptionTool(
  graphStore: GraphStorePort,
  saveDraft: (record: unknown) => Promise<void>,
  mintAssumptionId: (existingIds: readonly string[]) => string,
): ToolPort {
  return {
    name: 'writeAssumption',
    async execute(args): Promise<ToolResult> {
      const parsed = WriteAssumptionArgs.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }
      const {
        assumptionClass,
        statement,
        decisionId,
        status,
        tags,
        relatedAssumptions,
      } = parsed.data

      const existing = await graphStore.readAssumptions()
      const existingIds = existing.map((a) => a.id)
      const id = mintAssumptionId(existingIds)

      const assumption = {
        id,
        class: assumptionClass,
        statement,
        origin: { decision: decisionId },
        status,
        tags,
        related_assumptions: relatedAssumptions,
      }

      try {
        await saveDraft(assumption)
        return { success: true, data: { id, assumption } }
      } catch (err) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : 'Failed to write assumption',
        }
      }
    },
  }
}

const ProposeSpikeArgs = z.object({
  validatesAssumption: z.string(),
  killingQuestion: z.string(),
  timeboxDays: z.number().default(1),
})

export function createProposeSpikeTool(
  graphStore: GraphStorePort,
  saveDraft: (record: unknown) => Promise<void>,
  mintSpikeId: (existingIds: readonly string[]) => string,
): ToolPort {
  return {
    name: 'proposeSpike',
    async execute(args): Promise<ToolResult> {
      const parsed = ProposeSpikeArgs.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      const existing = await graphStore.readSpikes()
      const existingIds = existing.map((s) => s.id)
      const id = mintSpikeId(existingIds)

      const spike = {
        id,
        validates_assumption: parsed.data.validatesAssumption,
        killing_question: parsed.data.killingQuestion,
        scope: {
          timebox_days: parsed.data.timeboxDays,
          isolated: true,
          approved_by: 'pending',
        },
        reveals_assumptions: [],
        triggers_spikes: [],
      }

      try {
        await saveDraft(spike)
        return { success: true, data: { id, spike } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to propose spike',
        }
      }
    },
  }
}

export function createExecuteSpikeTool(spikeRunner: SpikeRunnerPort): ToolPort {
  const Args = z.object({
    spikeId: z.string(),
    code: z.string(),
    timeboxSeconds: z.number().default(300),
    networkAllowed: z.boolean().default(false),
    memoryLimitMb: z.number().default(512),
  })

  return {
    name: 'executeSpike',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      try {
        const result = await spikeRunner.execute(
          parsed.data.spikeId,
          parsed.data.code,
          {
            timeboxSeconds: parsed.data.timeboxSeconds,
            networkAllowed: parsed.data.networkAllowed,
            memoryLimitMb: parsed.data.memoryLimitMb,
            artefactDir: '',
          },
        )
        return { success: true, data: result }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Spike execution failed',
        }
      }
    },
  }
}

export class ToolDispatcher {
  private readonly tools: Map<string, ToolPort>

  constructor(tools: readonly ToolPort[]) {
    this.tools = new Map(tools.map((t) => [t.name, t]))
  }

  getRegisteredTools(): string[] {
    return Array.from(this.tools.keys())
  }

  async dispatch(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName)
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` }
    }
    return tool.execute(args)
  }
}
