import { describe, test, expect } from 'bun:test'
import type { ParsedResult } from '../../../application/ports'
import { AdrParser } from '../../../infrastructure/parsers/adr.parser'

function extractAdr(result: ParsedResult) {
  if (result.type !== 'adr') throw new Error('Expected adr result')
  return result.data
}

const FULL_NYGARD_ADR = `# 1. Use PostgreSQL for persistence

## Status

Accepted

## Context

We need a relational database that supports JSON queries. The team assumes PostgreSQL will handle our expected load of 10k queries/second. We expect the data to grow to about 500GB over the next two years.

## Decision

We will use PostgreSQL 15 as our primary data store. We rely on its native JSON support to avoid a separate document store. The application must use connection pooling via PgBouncer.

## Consequences

- Good: Single data store for both relational and document data
- Good: Strong ACID compliance
- Bad: Team needs to learn advanced PostgreSQL tuning
- Bad: Operational complexity for backups at scale
`

const MINIMAL_ADR = `# Use event sourcing

## Status

Proposed

## Context

We need to track all state changes for audit purposes.

## Decision

We will implement event sourcing for the order aggregate.

## Consequences

Event replay must be fast enough for production.
`

const SUPERSEDED_ADR = `# 3. Use MongoDB for document storage

## Status

Superseded by ADR-001 (use PostgreSQL)

## Context

We assumed we needed a separate document store for flexible schemas.

## Decision

Use MongoDB for product catalog data.

## Consequences

Operational overhead of running two databases.
`

const REJECTED_ADR = `# 5. Use microservices for everything

## Status

Rejected

## Context

Some team members believe microservices would solve our scaling needs. The team expects that we will grow to 50 developers within a year.

## Decision

Split every bounded context into a separate microservice.

## Consequences

Massive operational overhead for a small team.
`

const NO_STATUS_ADR = `# 2. Use Redis for caching

## Context

We need fast cache invalidation.

## Decision

Use Redis as a cache layer in front of PostgreSQL.

## Consequences

Cache invalidation is one of the hard problems in CS.
`

const ADR_WITH_NUMBERED_TITLE = `# 7. Adopt TypeScript for all new services

## Status

Accepted

## Context

We need type safety. The team should be able to catch errors at compile time.

## Decision

All new backend services will be written in TypeScript.

## Consequences

Better developer experience with IDE support.
`

describe('AdrParser', () => {
  test('parses full Nygard ADR into Decision record', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))

    expect(result.id).toMatch(/^DEC-\d{4}-001$/)
    expect(result.type).toBe('architecture')
    expect(result.status).toBe('active')
    expect(result.goal).toBe('Use PostgreSQL for persistence')
    expect(result.residue).toContain('Single data store')
    expect(result.residue).toContain('Team needs to learn')
    expect(result.commit_signatories).toEqual([])
    expect(result.arc42_sections_affected).toEqual([])
    expect(result.code_refs).toEqual([])
  })

  test('maps accepted status to active', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))
    expect(result.status).toBe('active')
  })

  test('maps proposed status to active', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(MINIMAL_ADR))
    expect(result.status).toBe('active')
  })

  test('maps superseded status correctly', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(SUPERSEDED_ADR))
    expect(result.status).toBe('superseded')
  })

  test('maps rejected status to rolled-back', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(REJECTED_ADR))
    expect(result.status).toBe('rolled-back')
  })

  test('defaults to active when status section is missing', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(NO_STATUS_ADR))
    expect(result.status).toBe('active')
  })

  test('extracts ADR number from title for ID generation', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(ADR_WITH_NUMBERED_TITLE))
    expect(result.id).toMatch(/^DEC-\d{4}-007$/)
  })

  test('strips leading number and dot from title for goal', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))
    expect(result.goal).toBe('Use PostgreSQL for persistence')
  })

  test('legacy ADRs have empty commit_signatories', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))
    expect(result.commit_signatories).toEqual([])
  })

  test('legacy ADRs have empty assumption arrays', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))
    expect(result.assumptions.validated).toEqual([])
    expect(result.assumptions.invalidated).toEqual([])
    expect(result.assumptions.accepted_bets).toEqual([])
  })

  test('output validates against DecisionSchema', async () => {
    const parser = new AdrParser()
    const result = extractAdr(await parser.parse(FULL_NYGARD_ADR))
    expect(result.id).toMatch(/^DEC-\d{4}-\d{3}$/)
    expect(['architecture', 'feature', 'migration', 'spike']).toContain(
      result.type,
    )
    expect(['active', 'superseded', 'rolled-back', 'validated']).toContain(
      result.status,
    )
  })

  test('result type is adr', async () => {
    const parser = new AdrParser()
    const result = await parser.parse(FULL_NYGARD_ADR)
    expect(result.type).toBe('adr')
  })
})

describe('AdrParser.extractAssumptions', () => {
  test('extracts assumption sentences from context section', () => {
    const assumptions = AdrParser.extractAssumptions(FULL_NYGARD_ADR)
    const joined = assumptions.join(' ')
    expect(joined).toContain('team assumes PostgreSQL will handle')
  })

  test('extracts assumption sentences from decision section', () => {
    const assumptions = AdrParser.extractAssumptions(FULL_NYGARD_ADR)
    const joined = assumptions.join(' ')
    expect(joined).toContain('rely on its native JSON support')
  })

  test('extracts multiple assumptions from both sections', () => {
    const assumptions = AdrParser.extractAssumptions(FULL_NYGARD_ADR)
    expect(assumptions.length).toBeGreaterThanOrEqual(3)
  })

  test('extracts belief statements', () => {
    const assumptions = AdrParser.extractAssumptions(REJECTED_ADR)
    const joined = assumptions.join(' ')
    expect(joined).toContain('believe microservices')
  })

  test('returns empty array for ADR with no assumptions', () => {
    const noAssumptionsAdr = `# Simple ADR

## Status

Accepted

## Context

The database is running fine.

## Decision

Do nothing.

## Consequences

No change.
`
    const assumptions = AdrParser.extractAssumptions(noAssumptionsAdr)
    expect(assumptions).toEqual([])
  })

  test('extracts should/expect statements', () => {
    const assumptions = AdrParser.extractAssumptions(ADR_WITH_NUMBERED_TITLE)
    const joined = assumptions.join(' ')
    expect(joined).toContain('should be able to catch errors')
  })
})

describe('AdrParser.extractAdrNumberFromFilename', () => {
  test('extracts number from NNNN-title format', () => {
    expect(AdrParser.extractAdrNumberFromFilename('0001-use-postgres.md')).toBe(
      1,
    )
  })

  test('extracts number from NN format', () => {
    expect(AdrParser.extractAdrNumberFromFilename('07-auth.md')).toBe(7)
  })

  test('extracts number from simple number format', () => {
    expect(AdrParser.extractAdrNumberFromFilename('15.md')).toBe(15)
  })

  test('returns null for non-numeric filenames', () => {
    expect(AdrParser.extractAdrNumberFromFilename('use-kafka.md')).toBeNull()
  })

  test('extracts number from docs/adr path', () => {
    expect(
      AdrParser.extractAdrNumberFromFilename('docs/adr/0003-cache.md'),
    ).toBe(3)
  })
})

describe('AdrParser.parseBatch', () => {
  test('parses multiple ADR files and returns decisions', async () => {
    const files = new Map<string, string>([
      ['0001-use-postgres.md', FULL_NYGARD_ADR],
      ['0002-event-sourcing.md', MINIMAL_ADR],
    ])

    const results = await AdrParser.parseBatch(files, '2026')
    expect(results.length).toBe(2)

    const first = extractAdr(results[0])
    expect(first.id).toBe('DEC-2026-001')

    const second = extractAdr(results[1])
    expect(second.id).toBe('DEC-2026-002')
  })

  test('sorts files by filename numerically', async () => {
    const files = new Map<string, string>([
      ['0010-tenth.md', FULL_NYGARD_ADR],
      ['0002-second.md', MINIMAL_ADR],
      ['0001-first.md', SUPERSEDED_ADR],
    ])

    const results = await AdrParser.parseBatch(files, '2026')
    const first = extractAdr(results[0])
    const second = extractAdr(results[1])
    const third = extractAdr(results[2])

    expect(first.id).toBe('DEC-2026-001')
    expect(second.id).toBe('DEC-2026-002')
    expect(third.id).toBe('DEC-2026-010')
  })

  test('uses ADR number from filename over title number', async () => {
    const files = new Map<string, string>([
      ['0005-fifth.md', ADR_WITH_NUMBERED_TITLE],
    ])

    const results = await AdrParser.parseBatch(files, '2026')
    const result = extractAdr(results[0])
    expect(result.id).toBe('DEC-2026-005')
  })

  test('handles empty file map', async () => {
    const files = new Map<string, string>()
    const results = await AdrParser.parseBatch(files, '2026')
    expect(results).toEqual([])
  })

  test('uses current year when year not specified', async () => {
    const files = new Map<string, string>([['0001-test.md', FULL_NYGARD_ADR]])

    const results = await AdrParser.parseBatch(files)
    const result = extractAdr(results[0])
    const currentYear = new Date().getFullYear().toString()
    expect(result.id).toBe(`DEC-${currentYear}-001`)
  })
})
