import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileSessionStore } from '../../../infrastructure/store/file-session.store'
import type {
  Assumption,
  Spike,
  SessionStateRecord,
} from '../../../domain/types'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dve-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const sampleState: SessionStateRecord = {
  state: 'SCOPING',
  metadata: { goal: 'Build auth system' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
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

describe('FileSessionStore', () => {
  describe('saveState / loadState', () => {
    test('persists and loads session state', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveState(sampleState)
      const loaded = await store.loadState()

      expect(loaded).not.toBeNull()
      expect(loaded!.state).toBe('SCOPING')
      expect(loaded!.metadata).toEqual({ goal: 'Build auth system' })
    })

    test('returns null when no state exists', async () => {
      const store = new FileSessionStore(tempDir)
      const loaded = await store.loadState()

      expect(loaded).toBeNull()
    })

    test('overwrites existing state', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveState(sampleState)
      const updated: SessionStateRecord = {
        ...sampleState,
        state: 'DECOMPOSING',
      }
      await store.saveState(updated)

      const loaded = await store.loadState()
      expect(loaded!.state).toBe('DECOMPOSING')
    })
  })

  describe('appendConversation / loadConversation', () => {
    test('appends and loads conversation entries', async () => {
      const store = new FileSessionStore(tempDir)

      const entry1 = {
        role: 'user' as const,
        content: 'Hello',
        timestamp: '2026-01-01T00:00:00Z',
      }
      const entry2 = {
        role: 'assistant' as const,
        content: 'Hi there',
        timestamp: '2026-01-01T00:00:01Z',
      }

      await store.appendConversation(entry1)
      await store.appendConversation(entry2)
      const entries = await store.loadConversation()

      expect(entries).toHaveLength(2)
      expect(entries[0].content).toBe('Hello')
      expect(entries[1].content).toBe('Hi there')
    })

    test('returns empty array when no conversation exists', async () => {
      const store = new FileSessionStore(tempDir)
      const entries = await store.loadConversation()

      expect(entries).toEqual([])
    })
  })

  describe('saveDraft / loadDrafts', () => {
    test('saves and loads assumption drafts', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveDraft(sampleAssumption)
      const drafts = await store.loadDrafts()

      expect(drafts.assumptions).toHaveLength(1)
      expect(drafts.assumptions[0].id).toBe('ASM-2026-001')
      expect(drafts.spikes).toHaveLength(0)
    })

    test('saves and loads spike drafts', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveDraft(sampleSpike)
      const drafts = await store.loadDrafts()

      expect(drafts.spikes).toHaveLength(1)
      expect(drafts.spikes[0].id).toBe('SPK-2026-001')
      expect(drafts.assumptions).toHaveLength(0)
    })

    test('loads mixed drafts', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveDraft(sampleAssumption)
      await store.saveDraft(sampleSpike)
      const drafts = await store.loadDrafts()

      expect(drafts.assumptions).toHaveLength(1)
      expect(drafts.spikes).toHaveLength(1)
    })

    test('returns empty when no drafts exist', async () => {
      const store = new FileSessionStore(tempDir)
      const drafts = await store.loadDrafts()

      expect(drafts.assumptions).toEqual([])
      expect(drafts.spikes).toEqual([])
    })
  })

  describe('clear', () => {
    test('removes all session files', async () => {
      const store = new FileSessionStore(tempDir)

      await store.saveState(sampleState)
      await store.appendConversation({
        role: 'user',
        content: 'test',
        timestamp: '2026-01-01T00:00:00Z',
      })
      await store.saveDraft(sampleAssumption)

      await store.clear()

      const state = await store.loadState()
      const conversation = await store.loadConversation()
      const drafts = await store.loadDrafts()

      expect(state).toBeNull()
      expect(conversation).toEqual([])
      expect(drafts.assumptions).toEqual([])
      expect(drafts.spikes).toEqual([])
    })

    test('is idempotent when no session exists', async () => {
      const store = new FileSessionStore(tempDir)

      await expect(store.clear()).resolves.toBeUndefined()
    })
  })
})
