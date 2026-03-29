import { describe, expect, it } from 'bun:test'
import { transition, getAllowedTransitions, validatePrerequisites } from '../../../domain/state-machine/machine'
import { TRANSITIONS, DEFAULT_LOOP_THRESHOLD } from '../../../domain/state-machine/states'
import type { SessionData } from '../../../domain/state-machine/states'
import type { SessionState } from '../../../domain/types'

type VisitMap = ReadonlyMap<SessionState, number>

const emptyData: SessionData = { assumptions: 0, approvedSpikes: 0 }
const validData: SessionData = { assumptions: 1, approvedSpikes: 1 }

describe('TRANSITIONS map', () => {
  it('defines all seven states', () => {
    expect(TRANSITIONS.size).toBe(7)
  })

  it('has SCOPING with only DECOMPOSING', () => {
    expect(TRANSITIONS.get('SCOPING')).toEqual(new Set(['DECOMPOSING']))
  })

  it('has COMMIT as terminal state with no exits', () => {
    expect(TRANSITIONS.get('COMMIT')).toEqual(new Set())
  })
})

describe('getAllowedTransitions', () => {
  it('returns correct targets for SCOPING', () => {
    expect(getAllowedTransitions('SCOPING')).toEqual(new Set(['DECOMPOSING']))
  })

  it('returns correct targets for DECOMPOSING', () => {
    expect(getAllowedTransitions('DECOMPOSING')).toEqual(new Set(['STRESS_TESTING', 'SCOPING']))
  })

  it('returns correct targets for STRESS_TESTING', () => {
    expect(getAllowedTransitions('STRESS_TESTING')).toEqual(new Set(['SPIKE_PLANNING', 'DECOMPOSING']))
  })

  it('returns correct targets for SPIKE_PLANNING', () => {
    expect(getAllowedTransitions('SPIKE_PLANNING')).toEqual(new Set(['SPIKE_REVIEW', 'STRESS_TESTING']))
  })

  it('returns correct targets for SPIKE_REVIEW', () => {
    expect(getAllowedTransitions('SPIKE_REVIEW')).toEqual(new Set(['SPIKE_EXECUTING', 'SPIKE_PLANNING']))
  })

  it('returns correct targets for SPIKE_EXECUTING', () => {
    expect(getAllowedTransitions('SPIKE_EXECUTING')).toEqual(new Set(['SPIKE_REVIEW', 'COMMIT']))
  })

  it('returns empty set for COMMIT', () => {
    expect(getAllowedTransitions('COMMIT')).toEqual(new Set())
  })
})

describe('validatePrerequisites', () => {
  it('rejects STRESS_TESTING with no assumptions', () => {
    const result = validatePrerequisites('DECOMPOSING', 'STRESS_TESTING', emptyData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('STRESS_TESTING')
      expect(result.message).toContain('assumption')
    }
  })

  it('allows STRESS_TESTING with at least one assumption', () => {
    expect(validatePrerequisites('DECOMPOSING', 'STRESS_TESTING', validData)).toEqual({ ok: true })
  })

  it('rejects SPIKE_EXECUTING with no approved spikes', () => {
    const result = validatePrerequisites('SPIKE_REVIEW', 'SPIKE_EXECUTING', emptyData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('SPIKE_EXECUTING')
      expect(result.message).toContain('approved spike')
    }
  })

  it('allows SPIKE_EXECUTING with at least one approved spike', () => {
    expect(validatePrerequisites('SPIKE_REVIEW', 'SPIKE_EXECUTING', validData)).toEqual({ ok: true })
  })

  it('rejects COMMIT with no assumptions', () => {
    const result = validatePrerequisites('SPIKE_EXECUTING', 'COMMIT', emptyData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('COMMIT')
      expect(result.message).toContain('assumption')
    }
  })

  it('allows COMMIT with at least one assumption', () => {
    expect(validatePrerequisites('SPIKE_EXECUTING', 'COMMIT', validData)).toEqual({ ok: true })
  })

  it('allows transitions without prerequisites', () => {
    expect(validatePrerequisites('SCOPING', 'DECOMPOSING', emptyData)).toEqual({ ok: true })
    expect(validatePrerequisites('DECOMPOSING', 'SCOPING', emptyData)).toEqual({ ok: true })
    expect(validatePrerequisites('STRESS_TESTING', 'DECOMPOSING', emptyData)).toEqual({ ok: true })
    expect(validatePrerequisites('SPIKE_PLANNING', 'STRESS_TESTING', validData)).toEqual({ ok: true })
    expect(validatePrerequisites('SPIKE_REVIEW', 'SPIKE_PLANNING', emptyData)).toEqual({ ok: true })
    expect(validatePrerequisites('SPIKE_EXECUTING', 'SPIKE_REVIEW', emptyData)).toEqual({ ok: true })
  })
})

describe('transition — valid transitions', () => {
  it('SCOPING → DECOMPOSING', () => {
    const result = transition('SCOPING', 'DECOMPOSING', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('DECOMPOSING')
      expect(result.visitCounts.get('DECOMPOSING')).toBe(1)
    }
  })

  it('DECOMPOSING → STRESS_TESTING (with assumptions)', () => {
    const result = transition('DECOMPOSING', 'STRESS_TESTING', validData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('STRESS_TESTING')
    }
  })

  it('DECOMPOSING → SCOPING (backward)', () => {
    const result = transition('DECOMPOSING', 'SCOPING', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SCOPING')
    }
  })

  it('STRESS_TESTING → SPIKE_PLANNING', () => {
    const result = transition('STRESS_TESTING', 'SPIKE_PLANNING', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SPIKE_PLANNING')
    }
  })

  it('STRESS_TESTING → DECOMPOSING (backward)', () => {
    const result = transition('STRESS_TESTING', 'DECOMPOSING', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('DECOMPOSING')
    }
  })

  it('SPIKE_PLANNING → SPIKE_REVIEW', () => {
    const result = transition('SPIKE_PLANNING', 'SPIKE_REVIEW', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SPIKE_REVIEW')
    }
  })

  it('SPIKE_PLANNING → STRESS_TESTING (backward)', () => {
    const result = transition('SPIKE_PLANNING', 'STRESS_TESTING', validData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('STRESS_TESTING')
    }
  })

  it('SPIKE_REVIEW → SPIKE_EXECUTING (with approved spikes)', () => {
    const result = transition('SPIKE_REVIEW', 'SPIKE_EXECUTING', validData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SPIKE_EXECUTING')
    }
  })

  it('SPIKE_REVIEW → SPIKE_PLANNING (backward)', () => {
    const result = transition('SPIKE_REVIEW', 'SPIKE_PLANNING', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SPIKE_PLANNING')
    }
  })

  it('SPIKE_EXECUTING → SPIKE_REVIEW (backward)', () => {
    const result = transition('SPIKE_EXECUTING', 'SPIKE_REVIEW', emptyData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('SPIKE_REVIEW')
    }
  })

  it('SPIKE_EXECUTING → COMMIT (with assumptions)', () => {
    const result = transition('SPIKE_EXECUTING', 'COMMIT', validData)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toBe('COMMIT')
    }
  })
})

describe('transition — illegal transitions', () => {
  it('rejects SCOPING → COMMIT', () => {
    const result = transition('SCOPING', 'COMMIT', validData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('illegal_transition')
      expect(result.error.current).toBe('SCOPING')
      expect(result.error.target).toBe('COMMIT')
    }
  })

  it('rejects self-transitions', () => {
    for (const state of TRANSITIONS.keys()) {
      const result = transition(state, state, validData)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.reason).toBe('illegal_transition')
      }
    }
  })

  it('rejects COMMIT → anything', () => {
    for (const state of TRANSITIONS.keys()) {
      if (state === 'COMMIT') continue
      const result = transition('COMMIT', state, validData)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.reason).toBe('illegal_transition')
      }
    }
  })

  it('rejects SCOPING → SPIKE_EXECUTING', () => {
    const result = transition('SCOPING', 'SPIKE_EXECUTING', validData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('illegal_transition')
    }
  })

  it('rejects DECOMPOSING → SPIKE_REVIEW', () => {
    const result = transition('DECOMPOSING', 'SPIKE_REVIEW', validData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('illegal_transition')
    }
  })

  it('includes descriptive message for illegal transition', () => {
    const result = transition('SCOPING', 'COMMIT', emptyData)
    if (!result.ok) {
      expect(result.error.message).toContain('SCOPING')
      expect(result.error.message).toContain('COMMIT')
      expect(result.error.message).toContain('not allowed')
    }
  })
})

describe('transition — prerequisites', () => {
  it('rejects DECOMPOSING → STRESS_TESTING without assumptions', () => {
    const result = transition('DECOMPOSING', 'STRESS_TESTING', emptyData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('prerequisites_not_met')
      expect(result.error.message).toContain('assumption')
    }
  })

  it('rejects SPIKE_REVIEW → SPIKE_EXECUTING without approved spikes', () => {
    const result = transition('SPIKE_REVIEW', 'SPIKE_EXECUTING', { assumptions: 1, approvedSpikes: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('prerequisites_not_met')
      expect(result.error.message).toContain('approved spike')
    }
  })

  it('rejects SPIKE_EXECUTING → COMMIT without assumptions', () => {
    const result = transition('SPIKE_EXECUTING', 'COMMIT', { assumptions: 0, approvedSpikes: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('prerequisites_not_met')
      expect(result.error.message).toContain('assumption')
    }
  })
})

describe('transition — loop detection', () => {
  it('allows transition when target has been visited fewer times than threshold', () => {
    const visits = new Map<SessionState, number>([['DECOMPOSING', 1]])
    const result = transition('SCOPING', 'DECOMPOSING', validData, visits)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.visitCounts.get('DECOMPOSING')).toBe(2)
    }
  })

  it('allows transition when target visits equal to threshold - 1', () => {
    const visits = new Map<SessionState, number>([['DECOMPOSING', DEFAULT_LOOP_THRESHOLD - 1]])
    const result = transition('SCOPING', 'DECOMPOSING', validData, visits)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.visitCounts.get('DECOMPOSING')).toBe(DEFAULT_LOOP_THRESHOLD)
    }
  })

  it('rejects transition when target visits reach threshold', () => {
    const visits = new Map<SessionState, number>([['DECOMPOSING', DEFAULT_LOOP_THRESHOLD]])
    const result = transition('SCOPING', 'DECOMPOSING', validData, visits)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('loop_detected')
      expect(result.error.message).toContain('Loop detected')
      expect(result.error.message).toContain('DECOMPOSING')
      expect(result.error.message).toContain(String(DEFAULT_LOOP_THRESHOLD))
    }
  })

  it('supports custom loop threshold', () => {
    const visits = new Map<SessionState, number>([['DECOMPOSING', 2]])
    const result = transition('SCOPING', 'DECOMPOSING', validData, visits, 2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('loop_detected')
    }
  })

  it('does not affect states without loop history', () => {
    const visits = new Map<SessionState, number>([['DECOMPOSING', 5]])
    const result = transition('STRESS_TESTING', 'SPIKE_PLANNING', emptyData, visits)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.visitCounts.get('SPIKE_PLANNING')).toBe(1)
      expect(result.visitCounts.get('DECOMPOSING')).toBe(5)
    }
  })

  it('preserves existing visit counts and adds new entry', () => {
    const visits = new Map<SessionState, number>([
      ['SCOPING', 1],
      ['DECOMPOSING', 2],
    ])
    const result = transition('DECOMPOSING', 'STRESS_TESTING', validData, visits)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.visitCounts.get('SCOPING')).toBe(1)
      expect(result.visitCounts.get('DECOMPOSING')).toBe(2)
      expect(result.visitCounts.get('STRESS_TESTING')).toBe(1)
    }
  })
})

describe('transition — full lifecycle', () => {
  it('walks the full forward path from SCOPING to COMMIT', () => {
    let visits: VisitMap = new Map()
    let result = transition('SCOPING', 'DECOMPOSING', emptyData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    visits = result.visitCounts

    result = transition('DECOMPOSING', 'STRESS_TESTING', validData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    visits = result.visitCounts

    result = transition('STRESS_TESTING', 'SPIKE_PLANNING', emptyData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    visits = result.visitCounts

    result = transition('SPIKE_PLANNING', 'SPIKE_REVIEW', emptyData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    visits = result.visitCounts

    result = transition('SPIKE_REVIEW', 'SPIKE_EXECUTING', validData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    visits = result.visitCounts

    result = transition('SPIKE_EXECUTING', 'COMMIT', validData, visits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toBe('COMMIT')
    expect(result.visitCounts.get('COMMIT')).toBe(1)
  })

  it('walks a back-and-forth path without triggering loop at threshold 3', () => {
    let visits: VisitMap = new Map()

    const steps: Array<{ from: SessionState; to: SessionState; data: SessionData }> = [
      { from: 'SCOPING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
      { from: 'STRESS_TESTING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
      { from: 'STRESS_TESTING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
    ]

    for (const step of steps) {
      const result = transition(step.from, step.to, step.data, visits)
      expect(result.ok).toBe(true)
      if (result.ok) visits = result.visitCounts
    }
  })

  it('detects loop after threshold back-and-forth trips', () => {
    let visits: VisitMap = new Map()

    const loopSteps: Array<{ from: SessionState; to: SessionState; data: SessionData }> = [
      { from: 'SCOPING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
      { from: 'STRESS_TESTING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
      { from: 'STRESS_TESTING', to: 'DECOMPOSING', data: emptyData },
      { from: 'DECOMPOSING', to: 'STRESS_TESTING', data: validData },
    ]

    for (const step of loopSteps) {
      const result = transition(step.from, step.to, step.data, visits)
      if (!result.ok) {
        throw new Error(`Unexpected failure: ${result.error.message}`)
      }
      if (result.ok) visits = result.visitCounts
    }

    const result = transition('STRESS_TESTING', 'DECOMPOSING', emptyData, visits)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('loop_detected')
    }
  })
})
