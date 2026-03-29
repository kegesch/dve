import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify as yamlStringify } from 'yaml'
import { YamlGraphStore } from '../../../infrastructure/graph/yaml-graph.store'
import type { Assumption, Decision, Spike } from '../../../domain/types'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dve-graph-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const sampleDecision: Decision = {
  id: 'DEC-2026-001',
  type: 'architecture',
  status: 'active',
  goal: 'Build auth system',
  assumptions: { validated: [], invalidated: [], accepted_bets: [] },
  residue: '',
  commit_signatories: [],
  arc42_sections_affected: [],
  code_refs: [],
}

const sampleAssumption: Assumption = {
  id: 'ASM-2026-001',
  class: 'technical',
  statement: 'Test assumption',
  origin: { decision: 'DEC-2026-001' },
  status: 'unvalidated',
  tags: ['test'],
  related_assumptions: [],
}

const sampleSpike: Spike = {
  id: 'SPK-2026-001',
  validates_assumption: 'ASM-2026-001',
  killing_question: 'Does it work?',
  scope: { timebox_days: 1, isolated: true, approved_by: 'test' },
  reveals_assumptions: [],
  triggers_spikes: [],
}

describe('YamlGraphStore', () => {
  describe('records', () => {
    test('writes and reads a decision record', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeRecord(sampleDecision)
      const records = await store.readRecords()

      expect(records).toHaveLength(1)
      expect(records[0].id).toBe('DEC-2026-001')
      expect(records[0].goal).toBe('Build auth system')
    })

    test('reads multiple records', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeRecord(sampleDecision)
      await store.writeRecord({ ...sampleDecision, id: 'DEC-2026-002' })
      const records = await store.readRecords()

      expect(records).toHaveLength(2)
    })

    test('returns empty when no records exist', async () => {
      const store = new YamlGraphStore(tempDir)
      const records = await store.readRecords()

      expect(records).toEqual([])
    })
  })

  describe('assumptions', () => {
    test('writes and reads an assumption', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeAssumption(sampleAssumption)
      const assumptions = await store.readAssumptions()

      expect(assumptions).toHaveLength(1)
      expect(assumptions[0].id).toBe('ASM-2026-001')
      expect(assumptions[0].statement).toBe('Test assumption')
    })

    test('returns empty when no assumptions exist', async () => {
      const store = new YamlGraphStore(tempDir)
      const assumptions = await store.readAssumptions()

      expect(assumptions).toEqual([])
    })
  })

  describe('spikes', () => {
    test('writes and reads a spike', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeSpike(sampleSpike)
      const spikes = await store.readSpikes()

      expect(spikes).toHaveLength(1)
      expect(spikes[0].id).toBe('SPK-2026-001')
      expect(spikes[0].killing_question).toBe('Does it work?')
    })

    test('returns empty when no spikes exist', async () => {
      const store = new YamlGraphStore(tempDir)
      const spikes = await store.readSpikes()

      expect(spikes).toEqual([])
    })
  })

  describe('context', () => {
    test('writes and reads arc42 context', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeContext('arc42', {
        sections: { context: 'Test context', goals: 'Auth' },
      })
      const ctx = await store.readContext()

      expect(ctx.arc42).not.toBeNull()
      expect(ctx.arc42!.sections.context).toBe('Test context')
    })

    test('writes and reads stack context', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeContext('stack', {
        technologies: ['TypeScript', 'Bun'],
      })
      const ctx = await store.readContext()

      expect(ctx.stack).not.toBeNull()
      expect(ctx.stack!.technologies).toEqual(['TypeScript', 'Bun'])
    })

    test('writes and reads gaps context', async () => {
      const store = new YamlGraphStore(tempDir)

      await store.writeContext('gaps', {
        gaps: [{ topic: 'Testing', description: 'Need more tests' }],
      })
      const ctx = await store.readContext()

      expect(ctx.gaps).not.toBeNull()
      expect(ctx.gaps!.gaps).toHaveLength(1)
    })

    test('returns null for missing context files', async () => {
      const store = new YamlGraphStore(tempDir)
      const ctx = await store.readContext()

      expect(ctx.arc42).toBeNull()
      expect(ctx.stack).toBeNull()
      expect(ctx.gaps).toBeNull()
    })
  })

  describe('validation', () => {
    test('throws on invalid record data', async () => {
      const store = new YamlGraphStore(tempDir)
      await mkdir(join(tempDir, 'records'), { recursive: true })
      await writeFile(
        join(tempDir, 'records', 'DEC-2026-099.yaml'),
        yamlStringify({ invalid: true }),
      )

      expect(() => store.readRecords()).toThrow()
    })
  })
})
