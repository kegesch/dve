import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  readdir,
  rename,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import type {
  SessionStorePort,
  ConversationEntry,
} from '../../application/ports'
import type { Assumption, SessionStateRecord, Spike } from '../../domain/types'
import { AssumptionSchema } from '../../domain/validation/schemas'
import { SpikeSchema } from '../../domain/validation/schemas'

export class FileSessionStore implements SessionStorePort {
  private readonly sessionDir: string
  private readonly stateFile: string
  private readonly conversationFile: string
  private readonly draftsDir: string

  constructor(baseDir: string) {
    this.sessionDir = join(baseDir, '.session')
    this.stateFile = join(this.sessionDir, 'state.yaml')
    this.conversationFile = join(this.sessionDir, 'conversation.jsonl')
    this.draftsDir = join(this.sessionDir, 'drafts')
  }

  async saveState(state: SessionStateRecord): Promise<void> {
    await this.ensureDir(this.sessionDir)
    const yaml = yamlStringify(state)
    const tmpFile = this.stateFile + '.tmp'
    await writeFile(tmpFile, yaml, 'utf-8')
    await rename(tmpFile, this.stateFile)
  }

  async loadState(): Promise<SessionStateRecord | null> {
    if (!existsSync(this.stateFile)) return null
    const content = await readFile(this.stateFile, 'utf-8')
    const parsed = yamlParse(content)
    return parsed as SessionStateRecord
  }

  async appendConversation(entry: ConversationEntry): Promise<void> {
    await this.ensureDir(this.sessionDir)
    const line = JSON.stringify(entry) + '\n'
    await writeFile(this.conversationFile, line, {
      encoding: 'utf-8',
      flag: 'a',
    })
  }

  async loadConversation(): Promise<readonly ConversationEntry[]> {
    if (!existsSync(this.conversationFile)) return []
    const content = await readFile(this.conversationFile, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    return lines.map((line) => JSON.parse(line) as ConversationEntry)
  }

  async saveDraft(record: Assumption | Spike): Promise<void> {
    await this.ensureDir(this.draftsDir)
    const filename = `${record.id}.yaml`
    const filepath = join(this.draftsDir, filename)
    const yaml = yamlStringify(record)
    const tmpFile = filepath + '.tmp'
    await writeFile(tmpFile, yaml, 'utf-8')
    await rename(tmpFile, filepath)
  }

  async loadDrafts(): Promise<{
    readonly assumptions: readonly Assumption[]
    readonly spikes: readonly Spike[]
  }> {
    if (!existsSync(this.draftsDir)) {
      return { assumptions: [], spikes: [] }
    }

    const files = await readdir(this.draftsDir)
    const yamlFiles = files.filter((f) => f.endsWith('.yaml'))

    const assumptions: Assumption[] = []
    const spikes: Spike[] = []

    for (const file of yamlFiles) {
      const content = await readFile(join(this.draftsDir, file), 'utf-8')
      const parsed = yamlParse(content)

      if (parsed.id?.startsWith('ASM-')) {
        assumptions.push(AssumptionSchema.parse(parsed))
      } else if (parsed.id?.startsWith('SPK-')) {
        spikes.push(SpikeSchema.parse(parsed))
      }
    }

    return { assumptions, spikes }
  }

  async clear(): Promise<void> {
    if (!existsSync(this.sessionDir)) return

    const files = [this.stateFile, this.conversationFile]
    for (const file of files) {
      if (existsSync(file)) {
        await unlink(file)
      }
    }

    if (existsSync(this.draftsDir)) {
      const draftFiles = await readdir(this.draftsDir)
      for (const file of draftFiles) {
        await unlink(join(this.draftsDir, file))
      }
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }
}
