import type { SessionState } from '../types'

export interface SessionData {
  readonly assumptions: number
  readonly approvedSpikes: number
}

export interface TransitionError {
  readonly current: SessionState
  readonly target: SessionState
  readonly reason: 'illegal_transition' | 'prerequisites_not_met' | 'loop_detected'
  readonly message: string
}

export type TransitionResult =
  | { readonly ok: true; readonly state: SessionState; readonly visitCounts: ReadonlyMap<SessionState, number> }
  | { readonly ok: false; readonly error: TransitionError }

export const DEFAULT_LOOP_THRESHOLD = 3

export const TRANSITIONS: ReadonlyMap<SessionState, ReadonlySet<SessionState>> = new Map([
  ['SCOPING', new Set(['DECOMPOSING'])],
  ['DECOMPOSING', new Set(['STRESS_TESTING', 'SCOPING'])],
  ['STRESS_TESTING', new Set(['SPIKE_PLANNING', 'DECOMPOSING'])],
  ['SPIKE_PLANNING', new Set(['SPIKE_REVIEW', 'STRESS_TESTING'])],
  ['SPIKE_REVIEW', new Set(['SPIKE_EXECUTING', 'SPIKE_PLANNING'])],
  ['SPIKE_EXECUTING', new Set(['SPIKE_REVIEW', 'COMMIT'])],
  ['COMMIT', new Set()],
])
