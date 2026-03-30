import { resolve, relative } from 'node:path'
import { readFile as fsReadFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type {
  ToolPort,
  ToolResult,
  GraphStorePort,
  HumanIOPort,
  SessionStorePort,
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

export function createApproveSpikeTool(
  sessionStore: SessionStorePort,
): ToolPort {
  const Args = z.object({ spikeId: z.string() })

  return {
    name: 'approveSpike',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      try {
        const drafts = await sessionStore.loadDrafts()
        const spike = drafts.spikes.find((s) => s.id === parsed.data.spikeId)
        if (!spike) {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} not found in drafts`,
          }
        }
        if (spike.scope.approved_by !== 'pending') {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} is not in pending state (approved_by: ${spike.scope.approved_by})`,
          }
        }

        const approved = {
          ...spike,
          scope: { ...spike.scope, approved_by: 'human' },
        }
        await sessionStore.saveDraft(approved)
        return {
          success: true,
          data: {
            id: approved.id,
            approved_by: approved.scope.approved_by,
          },
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to approve spike',
        }
      }
    },
  }
}

export function createModifySpikeTool(
  sessionStore: SessionStorePort,
): ToolPort {
  const Args = z.object({
    spikeId: z.string(),
    killingQuestion: z.string().optional(),
    timeboxDays: z.number().optional(),
  })

  return {
    name: 'modifySpike',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      try {
        const drafts = await sessionStore.loadDrafts()
        const spike = drafts.spikes.find((s) => s.id === parsed.data.spikeId)
        if (!spike) {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} not found in drafts`,
          }
        }
        if (spike.scope.approved_by !== 'pending') {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} is not in pending state`,
          }
        }

        const modified = {
          ...spike,
          killing_question:
            parsed.data.killingQuestion ?? spike.killing_question,
          scope: {
            ...spike.scope,
            timebox_days: parsed.data.timeboxDays ?? spike.scope.timebox_days,
          },
        }

        if (modified.killing_question.trim().length === 0) {
          return {
            success: false,
            error: 'Killing question must not be empty',
          }
        }
        if (modified.scope.timebox_days < 1) {
          return {
            success: false,
            error: 'Timebox must be at least 1 day',
          }
        }
        if (modified.scope.timebox_days > 30) {
          return {
            success: false,
            error: 'Timebox must not exceed 30 days',
          }
        }

        await sessionStore.saveDraft(modified)
        return {
          success: true,
          data: {
            id: modified.id,
            killing_question: modified.killing_question,
            timebox_days: modified.scope.timebox_days,
          },
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to modify spike',
        }
      }
    },
  }
}

export function createDropSpikeTool(sessionStore: SessionStorePort): ToolPort {
  const Args = z.object({
    spikeId: z.string(),
    reason: z.string(),
  })

  return {
    name: 'dropSpike',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      try {
        const drafts = await sessionStore.loadDrafts()
        const spike = drafts.spikes.find((s) => s.id === parsed.data.spikeId)
        if (!spike) {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} not found in drafts`,
          }
        }

        const assumption = drafts.assumptions.find(
          (a) => a.id === spike.validates_assumption,
        )
        if (assumption) {
          const acceptedBet = {
            ...assumption,
            status: 'accepted-bet' as const,
            evidence: {
              source: 'review' as const,
              finding: `Spike ${spike.id} dropped: ${parsed.data.reason}. Assumption accepted as conscious bet.`,
            },
          }
          await sessionStore.saveDraft(acceptedBet)
        }

        return {
          success: true,
          data: {
            droppedSpikeId: spike.id,
            acceptedBetAssumptionId: assumption?.id ?? null,
            reason: parsed.data.reason,
          },
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to drop spike',
        }
      }
    },
  }
}

export function createDeferSpikeTool(sessionStore: SessionStorePort): ToolPort {
  const Args = z.object({
    spikeId: z.string(),
    reason: z.string(),
  })

  return {
    name: 'deferSpike',
    async execute(args): Promise<ToolResult> {
      const parsed = Args.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: parsed.error.message }
      }

      try {
        const drafts = await sessionStore.loadDrafts()
        const spike = drafts.spikes.find((s) => s.id === parsed.data.spikeId)
        if (!spike) {
          return {
            success: false,
            error: `Spike ${parsed.data.spikeId} not found in drafts`,
          }
        }

        const deferred = {
          ...spike,
          scope: { ...spike.scope, approved_by: 'deferred' },
        }
        await sessionStore.saveDraft(deferred)
        return {
          success: true,
          data: {
            id: deferred.id,
            approved_by: deferred.scope.approved_by,
            reason: parsed.data.reason,
          },
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to defer spike',
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
