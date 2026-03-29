import { describe, test, expect } from 'bun:test'
import type { ParsedResult } from '../../../application/ports'
import { Arc42Parser } from '../../../infrastructure/parsers/arc42.parser'

function extractArc42(result: ParsedResult) {
  if (result.type !== 'arc42') throw new Error('Expected arc42 result')
  return result.data
}

const FULL_ARC42 = `# Architecture Documentation

Some preamble text about the project.

## 1. Introduction and Goals

We are building a microservice platform. Goals include scalability and resilience.

## 2. Architecture Constraints

Must use Java 21. Must deploy to Kubernetes.

## 3. System Scope and Context

### External Systems

- Payment Gateway (REST API)
- Notification Service (async events)

### Actors

- End User
- Admin

## 4. Solution Strategy

Event-driven architecture with CQRS.

## 5. Building Block View

### Level 1

The system consists of three main components.

### Level 2

Details about each component.

## 6. Runtime View

Sequence diagrams for key flows.

## 7. Deployment View

Kubernetes pods and services.

## 8. Cross-cutting Concepts

Logging, security, monitoring.

## 9. Architecture Decisions

ADR-001: Use event sourcing.
ADR-002: Use PostgreSQL.

## 10. Quality Requirements

| Quality | Scenario |
|---------|----------|
| Performance | 99th percentile < 200ms |
| Availability | 99.9% uptime |

## 11. Risks and Technical Debt

Team has limited Kubernetes experience.

## 12. Glossary

| Term | Definition |
|------|-----------|
| CQRS | Command Query Responsibility Segregation |
`

const PARTIAL_ARC42 = `## 1. Introduction and Goals

Build a REST API for user management.

## 3. System Scope and Context

External: Auth Provider (OAuth2)

## 5. Building Block View
`

const EMPTY_SECTIONS_ARC42 = `## 1. Introduction and Goals

Full goals here.

## 2. Architecture Constraints

## 3. System Scope and Context

Some context info.

## 4. Solution Strategy

## 5. Building Block View
`

const ALTERNATE_HEADING_FORMATS = `# arc42 Architecture

## Introduction and Goals

Primary goal is to deliver value fast.

## Architecture Constraints

Timebox to 3 months.

## System Scope and Context

External systems: ERP, CRM.
`

describe('Arc42Parser', () => {
  test('parses full arc42 document with all 12 sections', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(FULL_ARC42))

    expect(result.sections['introduction and goals']).toContain(
      'microservice platform',
    )
    expect(result.sections['architecture constraints']).toContain('Java 21')
    expect(result.sections['system scope and context']).toContain(
      'Payment Gateway',
    )
    expect(result.sections['solution strategy']).toContain('CQRS')
    expect(result.sections['building block view']).toContain('three main')
    expect(result.sections['runtime view']).toContain('Sequence diagrams')
    expect(result.sections['deployment view']).toContain('Kubernetes pods')
    expect(result.sections['cross-cutting concepts']).toContain('Logging')
    expect(result.sections['architecture decisions']).toContain('ADR-001')
    expect(result.sections['quality requirements']).toContain('Performance')
    expect(result.sections['risks and technical debt']).toContain('Kubernetes')
    expect(result.sections['glossary']).toContain('CQRS')
  })

  test('handles partial arc42 document without errors', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(PARTIAL_ARC42))

    expect(result.sections['introduction and goals']).toContain('REST API')
    expect(result.sections['system scope and context']).toContain(
      'Auth Provider',
    )
    expect(result.sections['building block view']).toBe('')
    expect(result.sections['architecture constraints']).toBe('')
    expect(result.sections['solution strategy']).toBe('')
    expect(result.sections['runtime view']).toBe('')
  })

  test('fills missing sections with empty strings', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(PARTIAL_ARC42))

    const expectedSections = [
      'introduction and goals',
      'architecture constraints',
      'system scope and context',
      'solution strategy',
      'building block view',
      'runtime view',
      'deployment view',
      'cross-cutting concepts',
      'architecture decisions',
      'quality requirements',
      'risks and technical debt',
      'glossary',
    ]

    for (const section of expectedSections) {
      expect(result.sections).toHaveProperty(section)
    }
  })

  test('identifies empty sections as gaps', async () => {
    const parser = new Arc42Parser()
    const data = extractArc42(await parser.parse(EMPTY_SECTIONS_ARC42))

    const gaps = Arc42Parser.findGaps(data)
    const gapTopics = gaps.map((g) => g.topic)

    expect(gapTopics).toContain('architecture constraints')
    expect(gapTopics).toContain('solution strategy')
    expect(gapTopics).toContain('building block view')
    expect(gapTopics).not.toContain('introduction and goals')
    expect(gapTopics).not.toContain('system scope and context')
  })

  test('findGaps returns all sections for empty document', async () => {
    const parser = new Arc42Parser()
    const data = extractArc42(await parser.parse(''))

    const gaps = Arc42Parser.findGaps(data)
    expect(gaps.length).toBe(12)
  })

  test('handles alternate heading formats without numbers', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(ALTERNATE_HEADING_FORMATS))

    expect(result.sections['introduction and goals']).toContain(
      'deliver value fast',
    )
    expect(result.sections['architecture constraints']).toContain('3 months')
    expect(result.sections['system scope and context']).toContain('ERP')
  })

  test('output validates against Arc42ContextSchema', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(FULL_ARC42))

    expect(typeof result.sections).toBe('object')
    expect(result.sections).not.toBeNull()
  })

  test('extracts sub-sections content under main headings', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(FULL_ARC42))

    expect(result.sections['system scope and context']).toContain(
      'Payment Gateway',
    )
    expect(result.sections['system scope and context']).toContain('End User')
  })

  test('findGaps returns empty array for fully populated document', async () => {
    const parser = new Arc42Parser()
    const data = extractArc42(await parser.parse(FULL_ARC42))

    const gaps = Arc42Parser.findGaps(data)
    expect(gaps.length).toBe(0)
  })

  test('stores preamble text before first section heading', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(await parser.parse(FULL_ARC42))

    expect(result.sections['preamble']).toContain(
      'Some preamble text about the project',
    )
  })

  test('handles document with only preamble and no sections', async () => {
    const parser = new Arc42Parser()
    const result = extractArc42(
      await parser.parse('Just some intro text with no headings.'),
    )

    expect(result.sections['preamble']).toContain('Just some intro text')
    const gaps = Arc42Parser.findGaps(result)
    expect(gaps.length).toBe(12)
  })

  test('gap descriptions reference the section name', async () => {
    const parser = new Arc42Parser()
    const data = extractArc42(await parser.parse(''))
    const gaps = Arc42Parser.findGaps(data)

    for (const gap of gaps) {
      expect(gap.topic).toBeTruthy()
      expect(gap.description).toContain(gap.topic)
      expect(gap.description).toContain('empty or missing')
    }
  })
})
