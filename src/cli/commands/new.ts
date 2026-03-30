import type { AppContainer } from '../container'
import type { SessionStateRecord, Assumption } from '../../domain/types'
import type { SessionData } from '../../domain/state-machine/states'
import type { ConversationMessage } from '../../application/ports'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import { findInvalidatedAssumptions } from '../../domain/graph/queries'

export interface NewCommandResult {
  completed: boolean
  finalState: string
  stopSignals: number
  interrupted: boolean
}

export async function runNew(
  container: AppContainer,
  goal?: string,
): Promise<NewCommandResult> {
  const { presenter, humanIO, sessionService, sessionStore } = container

  let interrupted = false

  const sigintHandler = () => {
    interrupted = true
  }
  process.on('SIGINT', sigintHandler)

  try {
    const decisionGoal =
      goal ?? (await humanIO.ask('What decision are you considering?'))

    if (!decisionGoal.trim()) {
      presenter.displayError('A goal is required to start a decision session')
      return {
        completed: false,
        finalState: 'SCOPING',
        stopSignals: 0,
        interrupted: false,
      }
    }

    presenter.display(`\nStarting decision session...\n`)
    presenter.display(`Goal: ${decisionGoal}\n`)

    const graph = await sessionService.loadGraph()

    const stopSignals = checkStopSignals(graph, decisionGoal)
    if (stopSignals.length > 0) {
      presenter.displayError(
        `Found ${stopSignals.length} stop signal(s) before starting:`,
      )
      for (const signal of stopSignals) {
        presenter.displayError(
          `  - ${signal.statement} (${signal.id}) [${signal.class}]`,
        )
      }

      const proceed = await humanIO.confirm(
        '\nStop signals detected. Continue anyway?',
      )
      if (!proceed) {
        presenter.display('Session aborted due to stop signals.')
        return {
          completed: false,
          finalState: 'SCOPING',
          stopSignals: stopSignals.length,
          interrupted: false,
        }
      }
    }

    const sessionState = await sessionService.startNewSession(decisionGoal)
    presenter.displayProgress('SCOPING')

    const pipeline = container.createSessionPipeline(graph)

    const sessionData: SessionData = {
      assumptions: 0,
      approvedSpikes: 0,
    }

    const existingConversation = await sessionStore.loadConversation()
    const initialMessages: ConversationMessage[] = existingConversation.map(
      (entry) => ({
        role: entry.role,
        content: entry.content,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
      }),
    )

    if (stopSignals.length > 0) {
      const signalSummary = stopSignals
        .map(
          (s) =>
            `- ${s.id}: "${s.statement}" (class: ${s.class}, status: ${s.status})`,
        )
        .join('\n')
      initialMessages.push({
        role: 'user',
        content: `The following stop signals were detected but the user chose to proceed:\n${signalSummary}\n\nTake these into account during analysis.`,
      })
    }

    const result = await pipeline.run(
      sessionState.state,
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
      completed: result.completed,
      finalState: result.finalState,
      stopSignals: stopSignals.length,
      interrupted,
    }
  } catch (err) {
    if (interrupted) {
      presenter.display('\n\nSession interrupted. State has been saved.')
      presenter.display('Run "dve resume" to continue this session.')
      return {
        completed: false,
        finalState: 'SCOPING',
        stopSignals: 0,
        interrupted: true,
      }
    }
    throw err
  } finally {
    process.removeListener('SIGINT', sigintHandler)
  }
}

function checkStopSignals(graph: KnowledgeGraph, goal: string): Assumption[] {
  const goalTokens = tokenize(goal)
  return findInvalidatedAssumptions(graph, goalTokens)
}

function tokenize(text: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'need',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'out',
    'off',
    'over',
    'under',
    'again',
    'further',
    'then',
    'once',
    'and',
    'but',
    'or',
    'nor',
    'not',
    'so',
    'yet',
    'both',
    'either',
    'neither',
    'each',
    'every',
    'all',
    'any',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'only',
    'own',
    'same',
    'than',
    'too',
    'very',
    'just',
    'because',
    'if',
    'when',
    'where',
    'how',
    'what',
    'which',
    'who',
    'whom',
    'this',
    'that',
    'these',
    'those',
    'i',
    'me',
    'my',
    'we',
    'our',
    'you',
    'your',
    'it',
    'its',
  ])
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
}

async function updateSessionOnCompletion(
  sessionService: import('../../application/session/session-service').SessionService,
  current: SessionStateRecord,
  finalState: string,
): Promise<SessionStateRecord> {
  const updated: SessionStateRecord = {
    ...current,
    state: finalState as SessionStateRecord['state'],
    updated_at: new Date().toISOString(),
  }
  await sessionService.updateState(updated)
  return updated
}
