import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import type { GraphStorePort } from '../../application/ports'
import type {
  Arc42Context,
  Assumption,
  Decision,
  GapsContext,
  Spike,
  StackContext,
} from '../../domain/types'
import {
  AssumptionSchema,
  DecisionSchema,
  SpikeSchema,
  Arc42ContextSchema,
  StackContextSchema,
  GapsContextSchema,
} from '../../domain/validation/schemas'

export class YamlGraphStore implements GraphStorePort {
  private readonly recordsDir: string
  private readonly assumptionsDir: string
  private readonly spikesDir: string
  private readonly contextDir: string

  constructor(baseDir: string) {
    this.recordsDir = join(baseDir, 'records')
    this.assumptionsDir = join(baseDir, 'assumptions')
    this.spikesDir = join(baseDir, 'spikes')
    this.contextDir = join(baseDir, 'context')
  }

  async readRecords(): Promise<readonly Decision[]> {
    return this.readDir(this.recordsDir, 'DEC-', (data) =>
      DecisionSchema.parse(data),
    )
  }

  async writeRecord(record: Decision): Promise<void> {
    await this.ensureDir(this.recordsDir)
    await this.writeYamlFile(this.recordsDir, `${record.id}.yaml`, record)
  }

  async readAssumptions(): Promise<readonly Assumption[]> {
    return this.readDir(this.assumptionsDir, 'ASM-', (data) =>
      AssumptionSchema.parse(data),
    )
  }

  async writeAssumption(assumption: Assumption): Promise<void> {
    await this.ensureDir(this.assumptionsDir)
    await this.writeYamlFile(
      this.assumptionsDir,
      `${assumption.id}.yaml`,
      assumption,
    )
  }

  async readSpikes(): Promise<readonly Spike[]> {
    return this.readDir(this.spikesDir, 'SPK-', (data) =>
      SpikeSchema.parse(data),
    )
  }

  async writeSpike(spike: Spike): Promise<void> {
    await this.ensureDir(this.spikesDir)
    await this.writeYamlFile(this.spikesDir, `${spike.id}.yaml`, spike)
  }

  async readContext(): Promise<{
    readonly arc42: Arc42Context | null
    readonly stack: StackContext | null
    readonly gaps: GapsContext | null
  }> {
    const readOptional = async <T>(
      filename: string,
      schema: { parse: (d: unknown) => T },
    ): Promise<T | null> => {
      const filepath = join(this.contextDir, filename)
      if (!existsSync(filepath)) return null
      const content = await readFile(filepath, 'utf-8')
      return schema.parse(yamlParse(content))
    }

    const [arc42, stack, gaps] = await Promise.all([
      readOptional('arc42.yaml', Arc42ContextSchema),
      readOptional('stack.yaml', StackContextSchema),
      readOptional('gaps.yaml', GapsContextSchema),
    ])

    return { arc42, stack, gaps }
  }

  async writeContext(
    type: 'arc42' | 'stack' | 'gaps',
    data: Arc42Context | StackContext | GapsContext,
  ): Promise<void> {
    await this.ensureDir(this.contextDir)
    await this.writeYamlFile(this.contextDir, `${type}.yaml`, data)
  }

  private async readDir<T>(
    dir: string,
    _prefix: string,
    parser: (data: unknown) => T,
  ): Promise<T[]> {
    if (!existsSync(dir)) return []
    const files = await readdir(dir)
    const results: T[] = []

    for (const file of files) {
      if (!file.endsWith('.yaml')) continue
      const content = await readFile(join(dir, file), 'utf-8')
      const parsed = yamlParse(content)
      results.push(parser(parsed))
    }

    return results
  }

  private async writeYamlFile(
    dir: string,
    filename: string,
    data: unknown,
  ): Promise<void> {
    const yaml = yamlStringify(data)
    const filepath = join(dir, filename)
    const tmpFile = filepath + '.tmp'
    await writeFile(tmpFile, yaml, 'utf-8')
    await rename(tmpFile, filepath)
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }
}
