import type { Assumption, Decision, Spike } from '../validation/schemas'
import type {
  GraphEdge,
  GraphNode,
  RecordType,
  RelationType,
} from './types'

type EdgeDirection = 'outgoing' | 'incoming' | 'both'

const ID_PREFIX_MAP: Record<string, RecordType> = {
  'ASM-': 'assumption',
  'DEC-': 'decision',
  'SPK-': 'spike',
}

function inferType(id: string): RecordType {
  for (const [prefix, type] of Object.entries(ID_PREFIX_MAP)) {
    if (id.startsWith(prefix)) return type
  }
  throw new Error(`Cannot infer record type from id: ${id}`)
}

function extractEdges(node: GraphNode): GraphEdge[] {
  const edges: GraphEdge[] = []
  const { id, type, data } = node

  if (type === 'assumption') {
    const asm = data as Assumption
    edges.push({ from: id, to: asm.origin.decision, relation: 'originates-from' })
    for (const related of asm.related_assumptions) {
      edges.push({ from: id, to: related, relation: 'related-to' })
    }
  }

  if (type === 'decision') {
    const dec = data as Decision
    for (const asmId of dec.assumptions.validated) {
      edges.push({ from: id, to: asmId, relation: 'has-assumption' })
    }
    for (const asmId of dec.assumptions.invalidated) {
      edges.push({ from: id, to: asmId, relation: 'has-assumption' })
    }
    for (const asmId of dec.assumptions.accepted_bets) {
      edges.push({ from: id, to: asmId, relation: 'has-assumption' })
    }
    if (dec.outcome?.superseded_by) {
      edges.push({ from: id, to: dec.outcome.superseded_by, relation: 'supersedes' })
    }
  }

  if (type === 'spike') {
    const spk = data as Spike
    edges.push({ from: id, to: spk.validates_assumption, relation: 'validates' })
    if (spk.parent_spike) {
      edges.push({ from: id, to: spk.parent_spike, relation: 'child-of' })
    }
    for (const asmId of spk.reveals_assumptions) {
      edges.push({ from: id, to: asmId, relation: 'reveals' })
    }
    for (const childId of spk.triggers_spikes) {
      edges.push({ from: id, to: childId, relation: 'triggers' })
    }
  }

  return edges
}

export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>()
  private outgoing = new Map<string, GraphEdge[]>()
  private incoming = new Map<string, GraphEdge[]>()

  addNode(record: Assumption | Decision | Spike): void {
    const type = inferType(record.id)
    const node: GraphNode = { id: record.id, type, data: record }
    this.nodes.set(record.id, node)

    const edges = extractEdges(node)
    for (const edge of edges) {
      this.addEdge(edge.from, edge.to, edge.relation)
    }
  }

  addEdge(from: string, to: string, relation: RelationType): void {
    const edge: GraphEdge = { from, to, relation }
    let outList = this.outgoing.get(from)
    if (!outList) {
      outList = []
      this.outgoing.set(from, outList)
    }
    outList.push(edge)

    let inList = this.incoming.get(to)
    if (!inList) {
      inList = []
      this.incoming.set(to, inList)
    }
    inList.push(edge)
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id)
  }

  getEdges(
    nodeId: string,
    direction: EdgeDirection = 'outgoing',
  ): GraphEdge[] {
    const result: GraphEdge[] = []
    if (direction === 'outgoing' || direction === 'both') {
      result.push(...(this.outgoing.get(nodeId) ?? []))
    }
    if (direction === 'incoming' || direction === 'both') {
      result.push(...(this.incoming.get(nodeId) ?? []))
    }
    return result
  }

  query(predicate: (node: GraphNode) => boolean): GraphNode[] {
    const result: GraphNode[] = []
    for (const node of this.nodes.values()) {
      if (predicate(node)) result.push(node)
    }
    return result
  }

  traverse(startId: string, relation: RelationType, depth: number): GraphNode[] {
    const visited = new Set<string>()
    const result: GraphNode[] = []
    const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }]
    visited.add(startId)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.hop > 0) {
        const node = this.nodes.get(current.id)
        if (node) result.push(node)
      }
      if (current.hop >= depth) continue

      const edges = this.outgoing.get(current.id) ?? []
      for (const edge of edges) {
        if (edge.relation === relation && !visited.has(edge.to)) {
          visited.add(edge.to)
          queue.push({ id: edge.to, hop: current.hop + 1 })
        }
      }
    }

    return result
  }

  getNeighbors(nodeId: string): GraphNode[] {
    const neighborIds = new Set<string>()
    for (const edge of this.outgoing.get(nodeId) ?? []) {
      neighborIds.add(edge.to)
    }
    for (const edge of this.incoming.get(nodeId) ?? []) {
      neighborIds.add(edge.from)
    }

    const result: GraphNode[] = []
    for (const id of neighborIds) {
      const node = this.nodes.get(id)
      if (node) result.push(node)
    }
    return result
  }

  get size(): { nodes: number; edges: number } {
    let edgeCount = 0
    for (const list of this.outgoing.values()) {
      edgeCount += list.length
    }
    return { nodes: this.nodes.size, edges: edgeCount }
  }
}
