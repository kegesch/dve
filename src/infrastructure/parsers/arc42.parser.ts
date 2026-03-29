import type { ParserPort, ParsedResult } from '../../application/ports'
import { Arc42ContextSchema } from '../../domain/validation/schemas'

const ARC42_SECTIONS = [
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
] as const

const SECTION_SPLIT_RE = /\n(?=##\s)/

function normalizeHeading(raw: string): string {
  const heading = raw
    .replace(/^\d+(\.\d+)*\.?\s*/, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .trim()
    .toLowerCase()
  return heading
}

function resolveSectionKey(normalized: string): string | null {
  if (ARC42_SECTIONS.includes(normalized as (typeof ARC42_SECTIONS)[number])) {
    return normalized
  }
  for (const canonical of ARC42_SECTIONS) {
    if (
      normalized.includes(canonical.split(' ').slice(0, 2).join(' ')) ||
      canonical.includes(normalized)
    ) {
      return canonical
    }
  }
  return null
}

function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()

  const preamble = markdown.split(SECTION_SPLIT_RE)[0]
  const preambleLines = preamble.split('\n')
  const startIdx = preambleLines[0]?.match(/^#\s+/) ? 1 : 0
  const preambleText = preambleLines.slice(startIdx).join('\n').trim()
  if (preambleText.length > 0) {
    sections.set('preamble', preambleText)
  }

  const parts = markdown.split(SECTION_SPLIT_RE)
  for (const part of parts) {
    const lines = part.split('\n')
    const headingLine = lines[0]
    if (!headingLine) continue

    const headingMatch = headingLine.match(/^##\s+(.+)$/)
    if (!headingMatch) continue

    const rawHeading = headingMatch[1].trim()
    const normalized = normalizeHeading(rawHeading)
    const key = resolveSectionKey(normalized)

    const content = lines.slice(1).join('\n').trim()

    if (key) {
      sections.set(key, content)
    } else {
      sections.set(normalized, content)
    }
  }

  return sections
}

export class Arc42Parser implements ParserPort {
  async parse(source: string): Promise<ParsedResult> {
    const sectionMap = parseSections(source)
    const sections: Record<string, string> = {}

    for (const [key, content] of sectionMap) {
      sections[key] = content
    }

    for (const canonical of ARC42_SECTIONS) {
      if (!(canonical in sections)) {
        sections[canonical] = ''
      }
    }

    const validated = Arc42ContextSchema.parse({ sections })
    return { type: 'arc42', data: validated }
  }

  static findGaps(context: { sections: Record<string, string> }): Array<{
    topic: string
    description: string
  }> {
    const gaps: Array<{ topic: string; description: string }> = []
    for (const canonical of ARC42_SECTIONS) {
      const content = context.sections[canonical]
      if (!content || content.trim().length === 0) {
        gaps.push({
          topic: canonical,
          description: `arc42 section "${canonical}" is empty or missing`,
        })
      }
    }
    return gaps
  }
}
