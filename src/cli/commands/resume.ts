import type { AppContainer } from '../container'
import type { SessionStateRecord } from '../../domain/types'
import type { SessionData } from '../../domain/state-machine/states'
import type { ConversationMessage } from '../../application/ports'

export interface ResumeResult {
  resumed: boolean
  finalState: string
  completed: boolean
  interrupted: boolean
  summary: SessionSummary | null
}

export interface SessionSummary {
  state: string
  goal: string
  assumptionsDrafted: number
  spikesDrafted: number
  conversationTurns: number
  createdAt: string
  updatedAt: string
}

export async function runResume(
  container: AppContainer,
): Promise<ResumeResult> {
  const { presenter, humanIO, sessionStore, sessionService } = container

  const sessionState = await sessionStore.loadState()

  if (!sessionState) {
    presenter.displayError('No interrupted session found.')
    presenter.display('Start a new session with "dve new <goal>".')
    return {
      resumed: false,
      finalState: '',
      completed: false,
      interrupted: false,
      summary: null,
    }
  }

  if (sessionState.state === 'COMMIT') {
    presenter.display(
      'Session is already at COMMIT state. Run "dve commit" to finalize.',
    )
    return {
      resumed: false,
      finalState: sessionState.state,
      completed: false,
      interrupted: false,
      summary: null,
    }
  }

  const drafts = await sessionStore.loadDrafts()
  const conversation = await sessionStore.loadConversation()

  const summary: SessionSummary = {
    state: sessionState.state,
    goal: (sessionState.metadata?.goal as string) ?? 'Unknown goal',
    assumptionsDrafted: drafts.assumptions.length,
    spikesDrafted: drafts.spikes.length,
    conversationTurns: conversation.length,
    createdAt: sessionState.created_at,
    updatedAt: sessionState.updated_at,
  }

  presenter.display('\n=== Resuming Session ===')
  presenter.display(`Goal: ${summary.goal}`)
  presenter.display(`State: ${summary.state}`)
  presenter.display(`Assumptions drafted: ${summary.assumptionsDrafted}`)
  presenter.display(`Spikes drafted: ${summary.spikesDrafted}`)
  presenter.display(`Conversation turns: ${summary.conversationTurns}`)
  presenter.display('')

  const proceed = await humanIO.confirm('Resume this session?')
  if (!proceed) {
    const clearSession = await humanIO.confirm(
      'Discard this session and start fresh?',
    )
    if (clearSession) {
      await sessionStore.clear()
      presenter.display('Session discarded.')
    } else {
      presenter.display('Session kept. Run "dve resume" to try again.')
    }
    return {
      resumed: false,
      finalState: sessionState.state,
      completed: false,
      interrupted: false,
      summary,
    }
  }

  let interrupted = false
  const sigintHandler = () => {
    interrupted = true
  }
  process.on('SIGINT', sigintHandler)

  try {
    const graph = await sessionService.loadGraph()

    const sessionData: SessionData = {
      assumptions: drafts.assumptions.length,
      approvedSpikes: drafts.spikes.filter((s) => s.scope?.approved_by).length,
    }

    const pipeline = container.createSessionPipeline(graph)

    const initialMessages: ConversationMessage[] = conversation.map(
      (entry) => ({
        role: entry.role,
        content: entry.content,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
      }),
    )

    initialMessages.push({
      role: 'user',
      content: `Resuming session from state ${sessionState.state}. Goal: ${summary.goal}. Continue from where we left off.`,
    })

    presenter.displayProgress(sessionState.state as never)

    const result = await pipeline.run(
      sessionState.state as never,
      sessionData,
      initialMessages,
    )

    await updateSessionOnCompletion(
      sessionService,
      sessionState,
      result.finalState,
    )

    if (result.completed) {
      await sessionService.endSession()
      presenter.display('\nDecision session completed and committed!')
    } else if (!interrupted) {
      presenter.display(`\nSession paused at state: ${result.finalState}`)
      presenter.display('Run "dve resume" to continue this session.')
    }

    return {
      resumed: true,
      finalState: result.finalState,
      completed: result.completed,
      interrupted,
      summary,
    }
  } catch (err) {
    if (interrupted) {
      presenter.display('\n\nSession interrupted. State has been saved.')
      presenter.display('Run "dve resume" to continue this session.')
      return {
        resumed: true,
        finalState: sessionState.state,
        completed: false,
        interrupted: true,
        summary,
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    presenter.displayError(`Failed to resume session: ${message}`)

    const repair = await humanIO.confirm(
      'Session may be corrupted. Clear and start fresh?',
    )
    if (repair) {
      await sessionStore.clear()
      presenter.display('Session cleared.')
    }

    return {
      resumed: false,
      finalState: sessionState.state,
      completed: false,
      interrupted: false,
      summary,
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler)
  }
}

async function updateSessionOnCompletion(
  sessionService: import('../../application/session/session-service').SessionService,
  current: SessionStateRecord,
  finalState: string,
): Promise<void> {
  const updated: SessionStateRecord = {
    ...current,
    state: finalState as SessionStateRecord['state'],
    updated_at: new Date().toISOString(),
  }
  await sessionService.updateState(updated)
}
