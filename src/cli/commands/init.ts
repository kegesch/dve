import { existsSync } from 'node:fs'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import type { AppContainer } from '../container'
import type {
  Arc42Context,
  StackContext,
  GapsContext,
  Decision,
} from '../../domain/types'
import { Arc42Parser } from '../../infrastructure/parsers/arc42.parser'
import { AdrParser } from '../../infrastructure/parsers/adr.parser'
import { CodebaseParser } from '../../infrastructure/parsers/codebase.parser'

const CONFIG_FILE_NAMES = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
]

const ARC42_PATTERNS = [
  'arc42.md',
  'architecture.md',
  'docs/arc42.md',
  'docs/architecture.md',
  'doc/arc42.md',
  'doc/architecture.md',
]

const ADR_DIR_PATTERNS = [
  'docs/adr',
  'doc/adr',
  'adr',
  'docs/decisions',
  'doc/decisions',
  'decisions',
]

async function findArc42File(cwd: string): Promise<string | null> {
  for (const pattern of ARC42_PATTERNS) {
    const full = resolve(cwd, pattern)
    if (existsSync(full)) return full
  }
  return null
}

async function findAdrDir(cwd: string): Promise<string | null> {
  const { stat } = await import('node:fs/promises')
  for (const pattern of ADR_DIR_PATTERNS) {
    const full = resolve(cwd, pattern)
    if (existsSync(full)) {
      try {
        const s = await stat(full)
        if (s.isDirectory()) return full
      } catch {
        continue
      }
    }
  }
  return null
}

async function collectConfigFiles(cwd: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const name of CONFIG_FILE_NAMES) {
    const full = resolve(cwd, name)
    if (existsSync(full)) {
      const content = await readFile(full, 'utf-8')
      files.set(name, content)
    }
  }
  return files
}

async function readAdrFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  if (!existsSync(dir)) return files

  const entries = await readdir(dir)
  const mdFiles = entries.filter(
    (f) => f.endsWith('.md') || f.endsWith('.adoc'),
  )

  for (const file of mdFiles) {
    const fullPath = join(dir, file)
    const content = await readFile(fullPath, 'utf-8')
    files.set(file, content)
  }

  return files
}

async function ensureDirectoryStructure(decisionsDir: string): Promise<void> {
  const dirs = [
    decisionsDir,
    join(decisionsDir, 'records'),
    join(decisionsDir, 'assumptions'),
    join(decisionsDir, 'spikes'),
    join(decisionsDir, 'context'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }
}

export interface InitResult {
  arc42Parsed: boolean
  adrsImported: number
  stackDetected: boolean
  gapsFound: number
  questionsAsked: number
  contextWritten: string[]
}

export async function runInit(
  container: AppContainer,
  cwd: string,
): Promise<InitResult> {
  const { presenter, humanIO, graphStore, parsers } = container
  const decisionsDir = container.config.decisionsDir

  presenter.display('Initializing DVE context...\n')

  await ensureDirectoryStructure(decisionsDir)

  const existingContext = await graphStore.readContext()
  const result: InitResult = {
    arc42Parsed: false,
    adrsImported: 0,
    stackDetected: false,
    gapsFound: 0,
    questionsAsked: 0,
    contextWritten: [],
  }

  let arc42Context = existingContext.arc42
  let stackContext = existingContext.stack
  const existingGaps = existingContext.gaps

  const arc42File = await findArc42File(cwd)
  if (arc42File) {
    presenter.display(`Found arc42 documentation: ${relative(cwd, arc42File)}`)
    const content = await readFile(arc42File, 'utf-8')
    const parsed = await parsers.arc42.parse(content)
    if (parsed.type === 'arc42') {
      if (arc42Context) {
        const merged = { ...arc42Context.sections, ...parsed.data.sections }
        arc42Context = { sections: merged } as Arc42Context
      } else {
        arc42Context = parsed.data
      }
      result.arc42Parsed = true
      presenter.display(
        `  Parsed ${Object.keys(parsed.data.sections).length} arc42 sections`,
      )
    }
  }

  const adrDir = await findAdrDir(cwd)
  if (adrDir) {
    presenter.display(`Found ADR directory: ${relative(cwd, adrDir)}`)
    const adrFiles = await readAdrFiles(adrDir)
    if (adrFiles.size > 0) {
      const year = new Date().getFullYear().toString()
      const adrResults = await AdrParser.parseBatch(adrFiles, year)
      const existingRecords = await graphStore.readRecords()
      const existingIds = new Set(existingRecords.map((r) => r.id))

      for (const res of adrResults) {
        if (res.type === 'adr') {
          const decision = res.data as Decision
          if (!existingIds.has(decision.id)) {
            await graphStore.writeRecord(decision)
            result.adrsImported++
          }
        }
      }
      presenter.display(`  Imported ${result.adrsImported} ADR(s)`)
    }
  }

  const configFiles = await collectConfigFiles(cwd)
  if (configFiles.size > 0) {
    presenter.display(
      `Found ${configFiles.size} config file(s) for stack detection`,
    )
    const parsed = await CodebaseParser.analyze(configFiles)
    if (parsed.type === 'codebase') {
      stackContext = parsed.data
      result.stackDetected = true
      presenter.display(
        `  Detected: ${(parsed.data as StackContext).technologies.join(', ')}`,
      )
    }
  }

  const allGaps: Array<{ topic: string; description: string }> = []

  if (arc42Context) {
    const arc42Gaps = Arc42Parser.findGaps(arc42Context)
    allGaps.push(...arc42Gaps)
  } else {
    allGaps.push({
      topic: 'arc42',
      description:
        'No arc42 documentation found. Architecture context is missing.',
    })
  }

  if (!stackContext || stackContext.technologies.length === 0) {
    allGaps.push({
      topic: 'tech-stack',
      description: 'Could not detect tech stack from config files.',
    })
  }

  if (existingGaps) {
    const resolvedTopics = new Set(
      existingGaps.gaps
        .filter((g) => {
          if (arc42Context && g.topic.startsWith('arc42 section')) return true
          if (stackContext && g.topic === 'tech-stack') return true
          return false
        })
        .map((g) => g.topic),
    )
    const remainingOld = existingGaps.gaps.filter(
      (g) => !resolvedTopics.has(g.topic),
    )
    allGaps.push(...remainingOld)
  }

  const unansweredGaps = allGaps.filter((gap) => {
    if (
      arc42Context &&
      gap.topic !== 'arc42' &&
      gap.description.includes('is empty or missing')
    ) {
      return false
    }
    return true
  })

  const questionsToAsk = unansweredGaps.slice(0, 5)
  const answers: Array<{ topic: string; answer: string }> = []

  for (const gap of questionsToAsk) {
    const answer = await humanIO.ask(
      `[GAP] ${gap.topic}: ${gap.description}\n  Please provide info or press Enter to skip:`,
    )
    if (answer.trim()) {
      answers.push({ topic: gap.topic, answer: answer.trim() })
      result.questionsAsked++
    }
  }

  if (arc42Context) {
    for (const { topic, answer } of answers) {
      if (arc42Context.sections[topic] !== undefined) {
        arc42Context.sections[topic] = answer
      }
    }
    await graphStore.writeContext('arc42', arc42Context)
    result.contextWritten.push('arc42')
  }

  if (stackContext) {
    await graphStore.writeContext('stack', stackContext)
    result.contextWritten.push('stack')
  }

  const remainingGaps = allGaps.filter(
    (g) => !answers.some((a) => a.topic === g.topic),
  )
  if (remainingGaps.length > 0 || existingGaps) {
    const gapsContext: GapsContext = {
      gaps: remainingGaps,
    }
    await graphStore.writeContext('gaps', gapsContext)
    result.contextWritten.push('gaps')
    result.gapsFound = remainingGaps.length
  }

  presenter.display('\nDVE initialization complete!')
  if (result.contextWritten.length > 0) {
    presenter.display(
      `  Context files written: ${result.contextWritten.join(', ')}`,
    )
  }
  if (result.adrsImported > 0) {
    presenter.display(`  ADRs imported: ${result.adrsImported}`)
  }
  if (result.gapsFound > 0) {
    presenter.display(`  Remaining gaps: ${result.gapsFound}`)
  }

  return result
}
