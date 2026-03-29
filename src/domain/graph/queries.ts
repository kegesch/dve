import type { Assumption, AssumptionClass } from '../validation/schemas'
import type { GraphNode } from './types'
import { KnowledgeGraph } from './knowledge-graph'

function isAssumption(
  node: GraphNode,
): node is GraphNode & { data: Assumption } {
  return node.type === 'assumption'
}

function tagsMatch(asm: Assumption, tags: string[]): boolean {
  if (tags.length === 0) return true
  return tags.some((tag) => asm.tags.includes(tag))
}

export function findInvalidatedAssumptions(
  graph: KnowledgeGraph,
  tags: string[],
): Assumption[] {
  return graph
    .query(
      (n) => isAssumption(n) && (n.data as Assumption).status === 'invalidated',
    )
    .map((n) => n.data as Assumption)
    .filter((a) => tagsMatch(a, tags))
}

export function findUnvalidatedBets(
  graph: KnowledgeGraph,
  tags: string[],
): Assumption[] {
  return graph
    .query(
      (n) =>
        isAssumption(n) && (n.data as Assumption).status === 'accepted-bet',
    )
    .map((n) => n.data as Assumption)
    .filter((a) => tagsMatch(a, tags))
}

export function findRelatedAssumptions(
  graph: KnowledgeGraph,
  assumptionId: string,
): Assumption[] {
  const start = graph.getNode(assumptionId)
  if (!start || !isAssumption(start)) return []

  const visited = new Set<string>([assumptionId])
  const queue: string[] = [assumptionId]
  const result: Assumption[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    const edges = graph.getEdges(current, 'both')
    for (const edge of edges) {
      if (edge.relation !== 'related-to') continue
      const neighborId = edge.from === current ? edge.to : edge.from
      if (visited.has(neighborId)) continue
      visited.add(neighborId)
      const node = graph.getNode(neighborId)
      if (node && isAssumption(node)) {
        result.push(node.data as Assumption)
        queue.push(neighborId)
      }
    }
  }

  return result
}

export function getImplicationChain(
  graph: KnowledgeGraph,
  assumptionId: string,
): Assumption[] {
  const start = graph.getNode(assumptionId)
  if (!start || !isAssumption(start)) return []

  const visited = new Set<string>([assumptionId])
  const queue: string[] = [assumptionId]
  const result: Assumption[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    const edges = graph.getEdges(current, 'outgoing')
    for (const edge of edges) {
      if (edge.relation !== 'related-to') continue
      if (visited.has(edge.to)) continue
      visited.add(edge.to)
      const node = graph.getNode(edge.to)
      if (node && isAssumption(node)) {
        result.push(node.data as Assumption)
        queue.push(edge.to)
      }
    }
  }

  return result
}

export function getAssumptionsForDecision(
  graph: KnowledgeGraph,
  decisionId: string,
): Assumption[] {
  const edges = graph.getEdges(decisionId, 'outgoing')
  const asmIds = new Set(
    edges.filter((e) => e.relation === 'has-assumption').map((e) => e.to),
  )

  const result: Assumption[] = []
  for (const id of asmIds) {
    const node = graph.getNode(id)
    if (node && isAssumption(node)) {
      result.push(node.data as Assumption)
    }
  }
  return result
}

export function findRelevantAssumptions(
  graph: KnowledgeGraph,
  tags: string[],
  assumptionClass?: AssumptionClass,
): Assumption[] {
  if (tags.length === 0) return []

  return graph
    .query((n) => {
      if (!isAssumption(n)) return false
      const asm = n.data as Assumption
      if (!tagsMatch(asm, tags)) return false
      if (assumptionClass && asm.class !== assumptionClass) return false
      return true
    })
    .map((n) => n.data as Assumption)
}
