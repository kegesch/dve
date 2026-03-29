import type { Assumption, Decision, Spike } from '../validation/schemas'

export type RecordType = 'assumption' | 'decision' | 'spike'

export type RelationType =
  | 'has-assumption'
  | 'originates-from'
  | 'validates'
  | 'reveals'
  | 'triggers'
  | 'child-of'
  | 'supersedes'
  | 'related-to'

export type GraphNodeData = Assumption | Decision | Spike

export interface GraphNode {
  readonly id: string
  readonly type: RecordType
  readonly data: GraphNodeData
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly relation: RelationType
}
