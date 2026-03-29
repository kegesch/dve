import type { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import type {
  Assumption,
  Arc42Context,
  SessionStateRecord,
  StackContext,
} from '../../domain/types'
import { findRelevantAssumptions } from '../../domain/graph/queries'

export interface DecompositionContext {
  readonly goal: string
  readonly arc42: Arc42Context | null
  readonly stack: StackContext | null
  readonly relevantAssumptions: readonly Assumption[]
  readonly existingDecisions: number
}

export function buildDecompositionContext(
  session: SessionStateRecord,
  graph: KnowledgeGraph,
  context: { arc42: Arc42Context | null; stack: StackContext | null },
): DecompositionContext {
  const goal = session.metadata.goal as string
  const tags = (session.metadata.tags as string[]) ?? []
  const relevantAssumptions = findRelevantAssumptions(graph, tags)
  const existingDecisions = graph.query((n) => n.type === 'decision').length

  return {
    goal,
    arc42: context.arc42,
    stack: context.stack,
    relevantAssumptions,
    existingDecisions,
  }
}
