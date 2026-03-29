import type { Assumption, SessionStateRecord, Spike } from '../../domain/types'

export interface ConversationEntry {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly timestamp: string
  readonly toolCallId?: string
  readonly toolName?: string
}

export interface SessionStorePort {
  saveState(state: SessionStateRecord): Promise<void>
  loadState(): Promise<SessionStateRecord | null>
  appendConversation(entry: ConversationEntry): Promise<void>
  loadConversation(): Promise<readonly ConversationEntry[]>
  saveDraft(record: Assumption | Spike): Promise<void>
  loadDrafts(): Promise<{
    readonly assumptions: readonly Assumption[]
    readonly spikes: readonly Spike[]
  }>
  clear(): Promise<void>
}
