import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify as yamlStringify } from 'yaml'
import type { Assumption, Spike } from '../../../domain/types'
import {
  buildSpikeReviewContext,
  approveSpike,
  modifySpike,
  dropSpike,
  deferSpike,
  formatSpikeForReview,
  validateModifiedSpike,
} from '../../../application/engine/spike-review'
import {
  createApproveSpikeTool,
  createModifySpikeTool,
  createDropSpikeTool,
  createDeferSpikeTool,
} from '../../../infrastructure/agent/tool-dispatcher'
import { FileSessionStore } from '../../../infrastructure/store/file-session.store'
import { writeFile, mkdir } from 'node:fs/promises'

function makeSpike(overrides: Partial<Spike> = {}): Spike {
  return {
    id: 'SPK-2026-001',
    validates_assumption: 'ASM-2026-001',
    killing_question:
      'Does the cache invalidate correctly under concurrent writes?',
    scope: {
      timebox_days: 2,
      isolated: true,
      approved_by: 'pending',
    },
    reveals_assumptions: [],
    triggers_spikes: [],
    ...overrides,
  }
}

function makeAssumption(overrides: Partial<Assumption> = {}): Assumption {
  return {
    id: 'ASM-2026-001',
    class: 'technical',
    statement: 'Cache invalidation is handled correctly by the framework',
    origin: { decision: 'DEC-2026-001' },
    status: 'unvalidated',
    tags: ['cache', 'concurrency'],
    related_assumptions: [],
    ...overrides,
  }
}

describe('spike-review (domain logic)', () => {
  describe('buildSpikeReviewContext', () => {
    test('filters pending spikes and links assumptions', () => {
      const spike1 = makeSpike({ id: 'SPK-2026-001' })
      const spike2 = makeSpike({
        id: 'SPK-2026-002',
        scope: { timebox_days: 1, isolated: true, approved_by: 'human' },
      })
      const assumption = makeAssumption()

      const ctx = buildSpikeReviewContext([spike1, spike2], [assumption])

      expect(ctx.proposedSpikes.length).toBe(1)
      expect(ctx.proposedSpikes[0]!.spike.id).toBe('SPK-2026-001')
      expect(ctx.proposedSpikes[0]!.assumption!.id).toBe('ASM-2026-001')
    })

    test('returns empty list when no pending spikes', () => {
      const spike = makeSpike({
        scope: { timebox_days: 1, isolated: true, approved_by: 'human' },
      })
      const ctx = buildSpikeReviewContext([spike], [])
      expect(ctx.proposedSpikes.length).toBe(0)
    })

    test('handles missing assumption gracefully', () => {
      const spike = makeSpike({
        validates_assumption: 'ASM-2026-999',
      })
      const ctx = buildSpikeReviewContext([spike], [])

      expect(ctx.proposedSpikes.length).toBe(1)
      expect(ctx.proposedSpikes[0]!.assumption).toBeNull()
    })
  })

  describe('approveSpike', () => {
    test('sets approved_by to the approver name', () => {
      const spike = makeSpike()
      const result = approveSpike(spike, 'Alice')
      expect(result.scope.approved_by).toBe('Alice')
    })

    test('preserves other spike fields', () => {
      const spike = makeSpike()
      const result = approveSpike(spike, 'Bob')
      expect(result.id).toBe(spike.id)
      expect(result.killing_question).toBe(spike.killing_question)
      expect(result.scope.timebox_days).toBe(spike.scope.timebox_days)
    })
  })

  describe('modifySpike', () => {
    test('updates killing question', () => {
      const spike = makeSpike()
      const result = modifySpike(spike, {
        killingQuestion: 'New killing question?',
      })
      expect(result.killing_question).toBe('New killing question?')
    })

    test('updates timebox days', () => {
      const spike = makeSpike()
      const result = modifySpike(spike, { timeboxDays: 5 })
      expect(result.scope.timebox_days).toBe(5)
    })

    test('preserves unmodified fields', () => {
      const spike = makeSpike()
      const result = modifySpike(spike, { timeboxDays: 3 })
      expect(result.killing_question).toBe(spike.killing_question)
    })
  })

  describe('dropSpike', () => {
    test('creates accepted-bet assumption from linked assumption', () => {
      const spike = makeSpike()
      const assumption = makeAssumption()
      const result = dropSpike(spike, assumption, 'Too risky to test')

      expect(result).not.toBeNull()
      expect(result!.status).toBe('accepted-bet')
      expect(result!.evidence!.source).toBe('review')
      expect(result!.evidence!.finding).toContain('Too risky to test')
    })

    test('returns null when assumption is null', () => {
      const spike = makeSpike()
      const result = dropSpike(spike, null, 'No assumption found')
      expect(result).toBeNull()
    })
  })

  describe('deferSpike', () => {
    test('marks spike as deferred', () => {
      const spike = makeSpike()
      const result = deferSpike(spike)
      expect(result.scope.approved_by).toBe('deferred')
    })

    test('preserves other spike fields', () => {
      const spike = makeSpike()
      const result = deferSpike(spike)
      expect(result.id).toBe(spike.id)
      expect(result.killing_question).toBe(spike.killing_question)
    })
  })

  describe('formatSpikeForReview', () => {
    test('formats spike with assumption details', () => {
      const spike = makeSpike()
      const assumption = makeAssumption()
      const output = formatSpikeForReview({ spike, assumption })

      expect(output).toContain('SPK-2026-001')
      expect(output).toContain('concurrent writes')
      expect(output).toContain('2 day(s)')
      expect(output).toContain('ASM-2026-001')
      expect(output).toContain('Cache invalidation')
      expect(output).toContain('approve / modify / drop / defer')
    })

    test('formats spike without assumption', () => {
      const spike = makeSpike()
      const output = formatSpikeForReview({ spike, assumption: null })

      expect(output).toContain('SPK-2026-001')
      expect(output).not.toContain('Assumption Statement')
    })

    test('includes parent spike when present', () => {
      const spike = makeSpike({ parent_spike: 'SPK-2026-000' })
      const output = formatSpikeForReview({ spike, assumption: null })
      expect(output).toContain('Parent Spike: SPK-2026-000')
    })
  })

  describe('validateModifiedSpike', () => {
    test('accepts valid spike', () => {
      const spike = makeSpike()
      const result = validateModifiedSpike(spike)
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    test('rejects empty killing question', () => {
      const spike = makeSpike({ killing_question: '  ' })
      const result = validateModifiedSpike(spike)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Killing question must not be empty')
    })

    test('rejects timebox less than 1 day', () => {
      const spike = makeSpike({
        scope: { timebox_days: 0, isolated: true, approved_by: 'pending' },
      })
      const result = validateModifiedSpike(spike)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Timebox must be at least 1 day')
    })

    test('rejects timebox over 30 days', () => {
      const spike = makeSpike({
        scope: { timebox_days: 31, isolated: true, approved_by: 'pending' },
      })
      const result = validateModifiedSpike(spike)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Timebox must not exceed 30 days')
    })
  })
})

describe('spike-review tool implementations', () => {
  let tmpDir: string
  let sessionStore: FileSessionStore

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `dve-test-spike-review-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    sessionStore = new FileSessionStore(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  async function seedDrafts(
    spikes: Spike[],
    assumptions: Assumption[],
  ): Promise<void> {
    const draftsDir = resolve(tmpDir, '.session', 'drafts')
    await mkdir(draftsDir, { recursive: true })
    for (const spike of spikes) {
      const filepath = resolve(draftsDir, `${spike.id}.yaml`)
      await writeFile(filepath, yamlStringify(spike), 'utf-8')
    }
    for (const asm of assumptions) {
      const filepath = resolve(draftsDir, `${asm.id}.yaml`)
      await writeFile(filepath, yamlStringify(asm), 'utf-8')
    }
  }

  describe('createApproveSpikeTool', () => {
    test('approves a pending spike', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createApproveSpikeTool(sessionStore)
      const result = await tool.execute({ spikeId: 'SPK-2026-001' })

      expect(result.success).toBe(true)
      const d = result.data as Record<string, unknown>
      expect(d.approved_by).toBe('human')

      const drafts = await sessionStore.loadDrafts()
      const approved = drafts.spikes.find((s) => s.id === 'SPK-2026-001')
      expect(approved!.scope.approved_by).toBe('human')
    })

    test('rejects approval of non-existent spike', async () => {
      const tool = createApproveSpikeTool(sessionStore)
      const result = await tool.execute({ spikeId: 'SPK-2026-999' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    test('rejects approval of already-approved spike', async () => {
      const spike = makeSpike({
        scope: { timebox_days: 1, isolated: true, approved_by: 'human' },
      })
      await seedDrafts([spike], [])

      const tool = createApproveSpikeTool(sessionStore)
      const result = await tool.execute({ spikeId: 'SPK-2026-001' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not in pending state')
    })
  })

  describe('createModifySpikeTool', () => {
    test('modifies killing question and timebox', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createModifySpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        killingQuestion: 'Updated question?',
        timeboxDays: 3,
      })

      expect(result.success).toBe(true)
      const d = result.data as Record<string, unknown>
      expect(d.killing_question).toBe('Updated question?')
      expect(d.timebox_days).toBe(3)
    })

    test('validates killing question is not empty', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createModifySpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        killingQuestion: '  ',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('must not be empty')
    })

    test('validates timebox minimum', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createModifySpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        timeboxDays: 0,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('at least 1 day')
    })

    test('validates timebox maximum', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createModifySpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        timeboxDays: 50,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('must not exceed 30 days')
    })

    test('rejects modification of non-pending spike', async () => {
      const spike = makeSpike({
        scope: { timebox_days: 1, isolated: true, approved_by: 'deferred' },
      })
      await seedDrafts([spike], [])

      const tool = createModifySpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        killingQuestion: 'New question?',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not in pending state')
    })
  })

  describe('createDropSpikeTool', () => {
    test('drops spike and creates accepted-bet assumption', async () => {
      const spike = makeSpike()
      const assumption = makeAssumption()
      await seedDrafts([spike], [assumption])

      const tool = createDropSpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        reason: 'Not worth the effort',
      })

      expect(result.success).toBe(true)
      const d = result.data as Record<string, unknown>
      expect(d.droppedSpikeId).toBe('SPK-2026-001')
      expect(d.acceptedBetAssumptionId).toBe('ASM-2026-001')

      const drafts = await sessionStore.loadDrafts()
      const updated = drafts.assumptions.find((a) => a.id === 'ASM-2026-001')
      expect(updated!.status).toBe('accepted-bet')
      expect(updated!.evidence!.finding).toContain('Not worth the effort')
    })

    test('drops spike without linked assumption', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createDropSpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        reason: 'No longer needed',
      })

      expect(result.success).toBe(true)
      const d = result.data as Record<string, unknown>
      expect(d.acceptedBetAssumptionId).toBeNull()
    })

    test('rejects drop of non-existent spike', async () => {
      const tool = createDropSpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-999',
        reason: 'Missing',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('createDeferSpikeTool', () => {
    test('defers a pending spike', async () => {
      const spike = makeSpike()
      await seedDrafts([spike], [])

      const tool = createDeferSpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-001',
        reason: 'Will run after commit',
      })

      expect(result.success).toBe(true)
      const d = result.data as Record<string, unknown>
      expect(d.approved_by).toBe('deferred')

      const drafts = await sessionStore.loadDrafts()
      const deferred = drafts.spikes.find((s) => s.id === 'SPK-2026-001')
      expect(deferred!.scope.approved_by).toBe('deferred')
    })

    test('rejects defer of non-existent spike', async () => {
      const tool = createDeferSpikeTool(sessionStore)
      const result = await tool.execute({
        spikeId: 'SPK-2026-999',
        reason: 'Missing',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })
})
