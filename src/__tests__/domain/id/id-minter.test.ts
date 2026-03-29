import { describe, expect, it } from 'bun:test'
import {
  mintAssumptionId,
  mintDecisionId,
  mintSpikeId,
} from '../../../domain/id/id-minter'

describe('mintDecisionId', () => {
  it('returns DEC-2026-001 for empty list', () => {
    expect(mintDecisionId('2026', [])).toBe('DEC-2026-001')
  })

  it('returns next sequential id', () => {
    expect(mintDecisionId('2026', ['DEC-2026-001'])).toBe('DEC-2026-002')
  })

  it('picks highest existing id', () => {
    expect(
      mintDecisionId('2026', ['DEC-2026-001', 'DEC-2026-003', 'DEC-2026-002']),
    ).toBe('DEC-2026-004')
  })

  it('ignores ids from different year', () => {
    expect(mintDecisionId('2027', ['DEC-2026-005', 'DEC-2026-010'])).toBe(
      'DEC-2027-001',
    )
  })

  it('ignores ids with different prefix', () => {
    expect(
      mintDecisionId('2026', ['ASM-2026-001', 'SPK-2026-003', 'DEC-2026-002']),
    ).toBe('DEC-2026-003')
  })

  it('handles year boundary correctly', () => {
    expect(
      mintDecisionId('2026', ['DEC-2025-001', 'DEC-2025-002', 'DEC-2026-001']),
    ).toBe('DEC-2026-002')
  })
})

describe('mintAssumptionId', () => {
  it('returns ASM-2026-001 for empty list', () => {
    expect(mintAssumptionId('2026', [])).toBe('ASM-2026-001')
  })

  it('returns next sequential id', () => {
    expect(mintAssumptionId('2026', ['ASM-2026-001'])).toBe('ASM-2026-002')
  })

  it('ignores other prefixes and years', () => {
    expect(
      mintAssumptionId('2026', ['DEC-2026-001', 'ASM-2025-005', 'ASM-2026-003']),
    ).toBe('ASM-2026-004')
  })
})

describe('mintSpikeId', () => {
  it('returns SPK-2026-001 for empty list', () => {
    expect(mintSpikeId('2026', [])).toBe('SPK-2026-001')
  })

  it('returns next sequential id', () => {
    expect(mintSpikeId('2026', ['SPK-2026-001'])).toBe('SPK-2026-002')
  })

  it('ignores other prefixes and years', () => {
    expect(
      mintSpikeId('2026', ['ASM-2026-001', 'SPK-2025-010', 'SPK-2026-002']),
    ).toBe('SPK-2026-003')
  })
})

describe('cross-prefix isolation', () => {
  it('each prefix counts independently', () => {
    const existing = ['DEC-2026-001', 'ASM-2026-001', 'ASM-2026-002', 'SPK-2026-001']
    expect(mintDecisionId('2026', existing)).toBe('DEC-2026-002')
    expect(mintAssumptionId('2026', existing)).toBe('ASM-2026-003')
    expect(mintSpikeId('2026', existing)).toBe('SPK-2026-002')
  })
})
