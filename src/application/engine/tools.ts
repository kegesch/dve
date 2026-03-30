import { z } from 'zod'
import type { SessionState } from '../../domain/types'
import type { ToolDefinition } from '../ports'

const queryGraphTool: ToolDefinition = {
  name: 'queryGraph',
  description:
    'Query the knowledge graph for assumptions, implication chains, stop signals, and related records',
  parameters: z.object({
    queryType: z.enum([
      'invalidated',
      'unvalidated_bets',
      'related',
      'implication_chain',
      'assumptions_for_decision',
      'relevant',
    ]),
    id: z.string().optional().describe('Record ID for targeted queries'),
    tags: z.array(z.string()).optional().describe('Tags to filter by'),
    assumptionClass: z
      .enum(['technical', 'environmental', 'domain'])
      .optional(),
  }),
}

const askHumanTool: ToolDefinition = {
  name: 'askHuman',
  description: 'Ask the human a question and wait for their response',
  parameters: z.object({
    question: z.string().describe('The question to ask the human'),
  }),
}

const writeAssumptionTool: ToolDefinition = {
  name: 'writeAssumption',
  description: 'Create or update a draft assumption in the session',
  parameters: z.object({
    assumptionClass: z.enum(['technical', 'environmental', 'domain']),
    statement: z.string(),
    decisionId: z.string(),
    status: z
      .enum(['unvalidated', 'validated', 'invalidated', 'accepted-bet'])
      .default('unvalidated'),
    tags: z.array(z.string()).default([]),
    relatedAssumptions: z.array(z.string()).default([]),
  }),
}

const proposeSpikeTool: ToolDefinition = {
  name: 'proposeSpike',
  description: 'Propose a new spike to validate an assumption',
  parameters: z.object({
    validatesAssumption: z.string(),
    killingQuestion: z.string(),
    timeboxDays: z.number().default(1),
  }),
}

const approveSpikeTool: ToolDefinition = {
  name: 'approveSpike',
  description: 'Mark a proposed spike as approved for execution',
  parameters: z.object({
    spikeId: z.string(),
  }),
}

const modifySpikeTool: ToolDefinition = {
  name: 'modifySpike',
  description: 'Modify spike scope before approval',
  parameters: z.object({
    spikeId: z.string(),
    killingQuestion: z.string().optional(),
    timeboxDays: z.number().optional(),
  }),
}

const dropSpikeTool: ToolDefinition = {
  name: 'dropSpike',
  description: 'Drop a proposed spike',
  parameters: z.object({
    spikeId: z.string(),
    reason: z.string(),
  }),
}

const deferSpikeTool: ToolDefinition = {
  name: 'deferSpike',
  description: 'Defer a proposed spike for post-commit execution',
  parameters: z.object({
    spikeId: z.string(),
    reason: z.string(),
  }),
}

const transitionTool: ToolDefinition = {
  name: 'transition',
  description: 'Propose transition to a different state in the pipeline',
  parameters: z.object({
    target: z.enum([
      'SCOPING',
      'DECOMPOSING',
      'STRESS_TESTING',
      'SPIKE_PLANNING',
      'SPIKE_REVIEW',
      'SPIKE_EXECUTING',
      'COMMIT',
    ]) as z.ZodType<SessionState>,
  }),
}

const updateRiskRankingTool: ToolDefinition = {
  name: 'updateRiskRanking',
  description: 'Update risk ranking for assumptions during stress testing',
  parameters: z.object({
    assumptionId: z.string(),
    implication: z.string(),
    signalType: z.enum(['type-1', 'type-2']),
  }),
}

const executeSpikeTool: ToolDefinition = {
  name: 'executeSpike',
  description: 'Run an approved spike in an isolated sandbox',
  parameters: z.object({
    spikeId: z.string(),
    code: z.string(),
    timeboxSeconds: z.number().default(300),
    networkAllowed: z.boolean().default(false),
    memoryLimitMb: z.number().default(512),
  }),
}

const generateBriefTool: ToolDefinition = {
  name: 'generateBrief',
  description: 'Generate the commit brief for the decision',
  parameters: z.object({
    summary: z.string(),
    validatedAssumptions: z.array(z.string()),
    invalidatedAssumptions: z.array(z.string()),
    acceptedBets: z.array(z.string()),
  }),
}

const writeRecordTool: ToolDefinition = {
  name: 'writeRecord',
  description: 'Write the final decision record',
  parameters: z.object({
    type: z.enum(['architecture', 'feature', 'migration', 'spike']),
    goal: z.string(),
    residue: z.string(),
  }),
}

const readFileTool: ToolDefinition = {
  name: 'readFile',
  description: 'Read a file from the project for codebase analysis',
  parameters: z.object({
    path: z.string().describe('Relative path to the file'),
  }),
}

const ALL_TOOLS: readonly ToolDefinition[] = [
  queryGraphTool,
  askHumanTool,
  writeAssumptionTool,
  proposeSpikeTool,
  approveSpikeTool,
  modifySpikeTool,
  dropSpikeTool,
  deferSpikeTool,
  transitionTool,
  updateRiskRankingTool,
  executeSpikeTool,
  generateBriefTool,
  writeRecordTool,
  readFileTool,
]

const STATE_TOOL_WHITELIST: Record<SessionState, readonly string[]> = {
  SCOPING: ['queryGraph', 'askHuman', 'readFile', 'transition'],
  DECOMPOSING: [
    'queryGraph',
    'askHuman',
    'readFile',
    'writeAssumption',
    'transition',
  ],
  STRESS_TESTING: [
    'queryGraph',
    'askHuman',
    'readFile',
    'writeAssumption',
    'updateRiskRanking',
    'transition',
  ],
  SPIKE_PLANNING: [
    'queryGraph',
    'askHuman',
    'readFile',
    'proposeSpike',
    'transition',
  ],
  SPIKE_REVIEW: [
    'queryGraph',
    'askHuman',
    'approveSpike',
    'modifySpike',
    'dropSpike',
    'deferSpike',
    'transition',
  ],
  SPIKE_EXECUTING: [
    'queryGraph',
    'askHuman',
    'readFile',
    'writeAssumption',
    'proposeSpike',
    'executeSpike',
    'transition',
  ],
  COMMIT: [
    'queryGraph',
    'askHuman',
    'generateBrief',
    'writeRecord',
    'transition',
  ],
}

export function getToolsForState(
  state: SessionState,
): readonly ToolDefinition[] {
  const allowed = STATE_TOOL_WHITELIST[state]
  return ALL_TOOLS.filter((t) => allowed.includes(t.name))
}

export function isToolAllowed(state: SessionState, toolName: string): boolean {
  return STATE_TOOL_WHITELIST[state]?.includes(toolName) ?? false
}

export { ALL_TOOLS }
