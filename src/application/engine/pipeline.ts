import type { SessionState } from '../../domain/types'
import type {
  AgentPort,
  ConversationMessage,
  HumanIOPort,
  PresenterPort,
  ToolPort,
} from '../ports'
import type { PipelineConfig, PipelineContext, PipelineResult } from './types'
import { DEFAULT_PIPELINE_CONFIG } from './types'
import { transition } from '../../domain/state-machine/machine'
import type { SessionData } from '../../domain/state-machine/states'
import { buildSystemPrompt } from './prompt-builder'
import { getToolsForState, isToolAllowed } from './tools'

export class Pipeline {
  private readonly config: PipelineConfig
  private readonly agent: AgentPort
  private readonly tools: ReadonlyMap<string, ToolPort>
  private readonly presenter: PresenterPort
  private readonly humanIO: HumanIOPort
  private readonly onStateChange?: (
    state: SessionState,
    context: PipelineContext,
  ) => Promise<void>

  constructor(deps: {
    agent: AgentPort
    tools: readonly ToolPort[]
    presenter: PresenterPort
    humanIO: HumanIOPort
    config?: Partial<PipelineConfig>
    onStateChange?: (
      state: SessionState,
      context: PipelineContext,
    ) => Promise<void>
  }) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...deps.config }
    this.agent = deps.agent
    this.tools = new Map(deps.tools.map((t) => [t.name, t]))
    this.presenter = deps.presenter
    this.humanIO = deps.humanIO
    this.onStateChange = deps.onStateChange
  }

  async run(
    initialState: SessionState,
    sessionData: SessionData,
    initialMessages: readonly ConversationMessage[] = [],
  ): Promise<PipelineResult> {
    let currentState = initialState
    const visitCounts = new Map<SessionState, number>()
    visitCounts.set(initialState, 1)
    const messages: ConversationMessage[] = [...initialMessages]
    let iteration = 0

    while (iteration < this.config.maxPipelineLoops) {
      iteration++

      const context: PipelineContext = {
        currentState,
        visitCounts,
        messages,
        iteration,
      }

      const systemPrompt = buildSystemPrompt(currentState, context)
      const toolDefs = getToolsForState(currentState)

      let stateChanged = false

      const agentMessages: ConversationMessage[] = [
        ...messages,
        {
          role: 'user',
          content:
            iteration === 1
              ? `Continue from state ${currentState}.`
              : `State is now ${currentState}. Continue.`,
        },
      ]

      const agentGen = this.agent.run({
        systemPrompt,
        messages: agentMessages,
        tools: toolDefs,
        maxIterations: this.config.maxAgentIterations,
      })

      for await (const event of agentGen) {
        if (event.type === 'text') {
          this.presenter.display(event.content)
          messages.push({ role: 'assistant', content: event.content })
        } else if (event.type === 'tool_call') {
          const result = await this.handleToolCall(
            currentState,
            event.tool,
            event.args,
          )
          messages.push({
            role: 'assistant',
            content: '',
            toolCallId: event.callId,
            toolName: event.tool,
          })
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: event.callId,
            toolName: event.tool,
          })
        } else if (event.type === 'transition') {
          const result = this.handleTransition(
            currentState,
            event.target,
            sessionData,
            visitCounts,
          )
          if (result.ok) {
            currentState = result.state
            visitCounts.clear()
            for (const [k, v] of result.visitCounts) {
              visitCounts.set(k, v)
            }
            stateChanged = true
            this.presenter.displayProgress(currentState)

            if (this.onStateChange) {
              await this.onStateChange(currentState, {
                currentState,
                visitCounts,
                messages,
                iteration,
              })
            }

            if (currentState === 'COMMIT') {
              return {
                completed: true,
                finalState: currentState,
                iterations: iteration,
                messages,
              }
            }
            break
          } else {
            this.presenter.displayError(
              `Transition rejected: ${result.error.message}`,
            )
            messages.push({
              role: 'tool',
              content: JSON.stringify({
                error: result.error.message,
                reason: result.error.reason,
              }),
            })
          }
        } else if (event.type === 'done') {
          return {
            completed: currentState === 'COMMIT',
            finalState: currentState,
            iterations: iteration,
            messages,
          }
        }
      }

      if (!stateChanged && iteration >= this.config.maxPipelineLoops) {
        this.presenter.displayError(
          `Pipeline exceeded maximum iterations (${this.config.maxPipelineLoops})`,
        )
        return {
          completed: false,
          finalState: currentState,
          iterations: iteration,
          messages,
        }
      }
    }

    return {
      completed: false,
      finalState: currentState,
      iterations: iteration,
      messages,
    }
  }

  private async handleToolCall(
    currentState: SessionState,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!isToolAllowed(currentState, toolName)) {
      return {
        success: false,
        error: `Tool "${toolName}" is not available in state ${currentState}`,
      }
    }

    if (toolName === 'askHuman') {
      const question = args.question as string
      try {
        const answer = await this.humanIO.ask(question)
        return { success: true, data: { answer } }
      } catch (err) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : 'Human interaction failed',
        }
      }
    }

    const tool = this.tools.get(toolName)
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" is not registered`,
      }
    }

    return tool.execute(args)
  }

  private handleTransition(
    current: SessionState,
    target: SessionState,
    sessionData: SessionData,
    visitCounts: ReadonlyMap<SessionState, number>,
  ) {
    return transition(
      current,
      target,
      sessionData,
      visitCounts,
      this.config.loopVisitThreshold,
    )
  }
}
