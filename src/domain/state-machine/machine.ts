import type { SessionState } from '../types'
import type { SessionData, TransitionResult } from './states'
import { DEFAULT_LOOP_THRESHOLD, TRANSITIONS } from './states'

export function getAllowedTransitions(current: SessionState): ReadonlySet<SessionState> {
  return TRANSITIONS.get(current) ?? new Set()
}

export function validatePrerequisites(
  current: SessionState,
  target: SessionState,
  sessionData: SessionData,
): { ok: true } | { ok: false; message: string } {
  if (target === 'STRESS_TESTING' && sessionData.assumptions < 1) {
    return {
      ok: false,
      message: 'Cannot enter STRESS_TESTING without at least one assumption from decomposition',
    }
  }
  if (target === 'SPIKE_EXECUTING' && sessionData.approvedSpikes < 1) {
    return {
      ok: false,
      message: 'Cannot enter SPIKE_EXECUTING without at least one approved spike',
    }
  }
  if (target === 'COMMIT' && sessionData.assumptions < 1) {
    return {
      ok: false,
      message: 'Cannot enter COMMIT without at least one assumption identified',
    }
  }
  return { ok: true }
}

export function transition(
  current: SessionState,
  target: SessionState,
  sessionData: SessionData,
  visitCounts: ReadonlyMap<SessionState, number> = new Map(),
  loopThreshold: number = DEFAULT_LOOP_THRESHOLD,
): TransitionResult {
  const allowed = getAllowedTransitions(current)
  if (!allowed.has(target)) {
    return {
      ok: false,
      error: {
        current,
        target,
        reason: 'illegal_transition',
        message: `Transition from ${current} to ${target} is not allowed`,
      },
    }
  }

  const prereq = validatePrerequisites(current, target, sessionData)
  if (!prereq.ok) {
    return {
      ok: false,
      error: {
        current,
        target,
        reason: 'prerequisites_not_met',
        message: prereq.message,
      },
    }
  }

  const targetVisits = visitCounts.get(target) ?? 0
  if (targetVisits >= loopThreshold) {
    return {
      ok: false,
      error: {
        current,
        target,
        reason: 'loop_detected',
        message: `Loop detected: ${target} has been visited ${targetVisits} times (threshold: ${loopThreshold})`,
      },
    }
  }

  const newVisitCounts = new Map(visitCounts)
  newVisitCounts.set(target, targetVisits + 1)

  return { ok: true, state: target, visitCounts: newVisitCounts }
}
