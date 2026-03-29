import type { ParserPort, ParsedResult } from '../../application/ports'
import { DecisionSchema } from '../../domain/validation/schemas'
import type { Decision } from '../../domain/types'

const ADR_SECTIONS = ['status', 'context', 'decision', 'consequences'] as const

const SECTION_SPLIT_RE = /\n(?=##\s)/

const STATUS_MAP: Record<string, Decision['status']> = {
  accepted: 'active',
  proposed: 'active',
  draft: 'active',
  deprecated: 'superseded',
  superseded: 'superseded',
  rejected: 'rolled-back',
  retired: 'rolled-back',
}

const ASSUMPTION_INDICATORS = [
  /\bassume[sd]?\b/i,
  /\bassumption\b/i,
  /\bexpect(?:ed|s)?\b/i,
  /\bshould\b/i,
  /\bmust\b/i,
  /\bneeds?\b/i,
  /\bbelieve[ds]?\b/i,
  /\brel[iy](?:es|ant)?\s+on\b/i,
  /\brequires?\b/i,
  /\bdepends?\s+on\b/i,
  /\bprovided\s+that\b/i,
  /\bgiven\s+that\b/i,
]

function normalizeSectionHeading(raw: string): string {
  return raw.trim().toLowerCase()
}

function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()

  const titleAndPreamble = markdown.split(SECTION_SPLIT_RE)[0]
  const titleLines = titleAndPreamble.split('\n')
  const titleMatch = titleLines[0]?.match(/^#\s+(.+)$/)
  if (titleMatch) {
    sections.set('title', titleMatch[1].trim())
    const preamble = titleLines.slice(1).join('\n').trim()
    if (preamble.length > 0) {
      sections.set('preamble', preamble)
    }
  }

  const parts = markdown.split(SECTION_SPLIT_RE)
  for (const part of parts) {
    const lines = part.split('\n')
    const headingLine = lines[0]
    if (!headingLine) continue

    const headingMatch = headingLine.match(/^##\s+(.+)$/)
    if (!headingMatch) continue

    const rawHeading = headingMatch[1].trim()
    const normalized = normalizeSectionHeading(rawHeading)
    const content = lines.slice(1).join('\n').trim()

    if (ADR_SECTIONS.includes(normalized as (typeof ADR_SECTIONS)[number])) {
      sections.set(normalized, content)
    } else {
      sections.set(normalized, content)
    }
  }

  return sections
}

function extractTitle(sections: Map<string, string>): string {
  const title = sections.get('title') ?? 'Untitled ADR'
  const cleaned = title.replace(/^\d+[.\s-]*/, '').trim()
  return cleaned || title
}

function extractAdrNumber(source: string): number {
  const titleMatch = source.match(/^#\s+(\d+)/m)
  if (titleMatch) return parseInt(titleMatch[1], 10)

  return 1
}

function mapStatus(rawStatus: string): Decision['status'] {
  const normalized = rawStatus.trim().toLowerCase()
  for (const [key, value] of Object.entries(STATUS_MAP)) {
    if (normalized.includes(key)) return value
  }
  return 'active'
}

function extractAssumptionSentences(text: string): string[] {
  const sentences = text
    .split(/[.!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)

  const assumptions: string[] = []
  for (const sentence of sentences) {
    for (const pattern of ASSUMPTION_INDICATORS) {
      if (pattern.test(sentence)) {
        assumptions.push(sentence)
        break
      }
    }
  }
  return assumptions
}

export class AdrParser implements ParserPort {
  async parse(source: string): Promise<ParsedResult> {
    const sections = parseSections(source)
    const title = extractTitle(sections)
    const statusText = sections.get('status') ?? 'accepted'
    const consequences = sections.get('consequences') ?? ''
    const adrNum = extractAdrNumber(source)
    const year = new Date().getFullYear().toString()
    const id = `DEC-${year}-${adrNum.toString().padStart(3, '0')}`

    const decision = {
      id,
      type: 'architecture' as const,
      status: mapStatus(statusText),
      goal: title,
      assumptions: {
        validated: [],
        invalidated: [],
        accepted_bets: [],
      },
      residue: consequences,
      outcome: undefined,
      commit_signatories: [],
      arc42_sections_affected: [],
      code_refs: [],
    }

    const validated = DecisionSchema.parse(decision)
    return { type: 'adr', data: validated }
  }

  static extractAssumptions(source: string): string[] {
    const sections = parseSections(source)
    const contextText = sections.get('context') ?? ''
    const decisionText = sections.get('decision') ?? ''
    return [
      ...extractAssumptionSentences(contextText),
      ...extractAssumptionSentences(decisionText),
    ]
  }

  static extractAdrNumberFromFilename(filename: string): number | null {
    const base = filename.replace(/^.*[\\/]/, '')
    const match = base.match(/^(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  static async parseBatch(
    files: ReadonlyMap<string, string>,
    year?: string,
  ): Promise<ParsedResult[]> {
    const yr = year ?? new Date().getFullYear().toString()
    const parser = new AdrParser()
    const results: ParsedResult[] = []

    const sortedFiles = [...files.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )

    for (const [_filename, content] of sortedFiles) {
      const result = await parser.parse(content)
      if (result.type === 'adr') {
        const fileNum = AdrParser.extractAdrNumberFromFilename(_filename)
        if (fileNum !== null) {
          const overridden = DecisionSchema.parse({
            ...result.data,
            id: `DEC-${yr}-${fileNum.toString().padStart(3, '0')}`,
          })
          results.push({ type: 'adr', data: overridden })
        } else {
          results.push(result)
        }
      }
    }

    return results
  }
}
