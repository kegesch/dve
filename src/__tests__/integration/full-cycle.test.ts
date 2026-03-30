import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse } from 'yaml'
import { runInit } from '../../cli/commands/init'
import { runCommit } from '../../cli/commands/commit'
import type { AppContainer } from '../../cli/container'
import type { DveConfig } from '../../cli/config'
import type {
  AgentPort,
  HumanIOPort,
  PresenterPort,
  ToolPort,
} from '../../application/ports'
import type { Assumption, Spike, SessionStateRecord } from '../../domain/types'
import { YamlGraphStore } from '../../infrastructure/graph/yaml-graph.store'
import { FileSessionStore } from '../../infrastructure/store/file-session.store'
import { SessionService } from '../../application/session/session-service'
import { Pipeline } from '../../application/engine/pipeline'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import { Arc42Parser } from '../../infrastructure/parsers/arc42.parser'
import { AdrParser } from '../../infrastructure/parsers/adr.parser'
import { CodebaseParser } from '../../infrastructure/parsers/codebase.parser'
import type { ParserPort } from '../../application/ports'
import {
  createQueryGraphTool,
  createWriteAssumptionTool,
  createProposeSpikeTool,
  createApproveSpikeTool,
  createAskHumanTool,
  createReadFileTool,
} from '../../infrastructure/agent/tool-dispatcher'
import { mintAssumptionId, mintSpikeId } from '../../domain/id/id-minter'
import { SessionStateSchema } from '../../domain/validation/schemas'

import type { SessionState } from '../../domain/types'
import type { SessionData } from '../../domain/state-machine/states'

function makeTestConfig(tmpDir: string): DveConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'test-api-key',
    decisionsDir: tmpDir,
  }
}

class MockPresenter implements PresenterPort {
  readonly messages: string[] = []
  readonly errors: string[] = []

  display(message: string): void {
    this.messages.push(message)
  }

  displayError(error: string): void {
    this.errors.push(error)
  }

  displayTable(): void {}

  displayProgress(state: string): void {
    this.messages.push(`[${state}]`)
  }
}

class MockHumanIO implements HumanIOPort {
  private responses: string[] = []
  private confirms: boolean[] = []

  setResponses(responses: string[]): void {
    this.responses = [...responses]
  }

  setConfirms(confirms: boolean[]): void {
    this.confirms = [...confirms]
  }

  async ask(): Promise<string> {
    return this.responses.shift() ?? ''
  }

  async confirm(): Promise<boolean> {
    return this.confirms.shift() ?? false
  }

  async select<T extends string>(
    _question: string,
    options: readonly { readonly value: T; readonly label: string }[],
  ): Promise<T> {
    return options[0]!.value
  }
}

const SAMPLE_ARC42 = `# Architecture

## Introduction and Goals
Build a microservice for user management.

## Architecture Constraints
Must use TypeScript.

## System Scope and Context
External API gateway connects to the service.

## Solution Strategy
REST API with Express.

## Building Block View

## Runtime View

## Deployment View

## Cross-Cutting Concepts

## Architecture Decisions

## Quality Requirements

## Risks and Technical Debt

## Glossary
`

const SAMPLE_ADR = `# 1. Use PostgreSQL for persistence

## Status
Accepted

## Context
We need a relational database.

## Decision
Use PostgreSQL 15.

## Consequences
Need to manage schema migrations.
`

const SAMPLE_PACKAGE_JSON = JSON.stringify(
  {
    name: 'test-project',
    type: 'module',
    dependencies: { typescript: '^5.0.0', express: '^4.18.0' },
    devDependencies: { jest: '^29.0.0' },
  },
  null,
  2,
)

const COMMIT_PIPELINE_STATES: SessionState[] = [
  'DECOMPOSING',
  'STRESS_TESTING',
  'SPIKE_PLANNING',
  'SPIKE_REVIEW',
  'SPIKE_EXECUTING',
  'COMMIT',
]

function createAgentDrivingToCommit(): AgentPort {
  let callIdx = 0

  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    run: async function* () {
      callIdx++
      const stateIndex = callIdx - 1

      if (stateIndex >= COMMIT_PIPELINE_STATES.length) {
        yield { type: 'done' as const, summary: 'complete' }
        return
      }

      if (stateIndex === 0) {
        yield {
          type: 'text' as const,
          content: 'Decomposing the goal into assumptions...',
        }
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'technical',
            statement: 'TypeScript performance is adequate for our use case',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['tech-stack', 'performance'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${stateIndex}`,
        }
        yield {
          type: 'tool_call' as const,
          tool: 'writeAssumption' as const,
          args: {
            assumptionClass: 'environmental',
            statement: 'Team has experience with the chosen framework',
            decisionId: 'DEC-2026-000',
            status: 'validated',
            tags: ['team', 'capability'],
            relatedAssumptions: [] as string[],
          },
          callId: `tc-asm-${stateIndex}-b`,
        }
      }

      if (stateIndex === 4) {
        yield {
          type: 'tool_call' as const,
          tool: 'proposeSpike' as const,
          args: {
            validatesAssumption: 'ASM-2026-001',
            killingQuestion: 'Can the system handle 10k concurrent users?',
            timeboxDays: 3,
          },
          callId: `tc-spk-${stateIndex}`,
        }
        yield {
          type: 'tool_call' as const,
          tool: 'approveSpike' as const,
          args: {
            spikeId: 'SPK-2026-001',
          },
          callId: `tc-appr-${stateIndex}`,
        }
      }

      yield {
        type: 'transition' as const,
        target: COMMIT_PIPELINE_STATES[stateIndex]!,
      }
    },
  }
}

function buildContainerWithFakeAgent(
  tmpDir: string,
  humanIO: MockHumanIO,
  fakeAgent: AgentPort,
): AppContainer {
  const config = makeTestConfig(tmpDir)
  const presenter = new MockPresenter()
  const graphStore = new YamlGraphStore(tmpDir)
  const sessionStore = new FileSessionStore(tmpDir)
  const sessionService = new SessionService(sessionStore, graphStore)

  function createSessionPipeline(graph: KnowledgeGraph): Pipeline {
    const year = new Date().getFullYear().toString()
    const tools: ToolPort[] = [
      createQueryGraphTool(graph),
      createReadFileTool(tmpDir),
      createAskHumanTool(humanIO),
      createWriteAssumptionTool(
        graphStore,
        (record) => sessionStore.saveDraft(record as Assumption),
        (ids) => mintAssumptionId(year, ids),
      ),
      createProposeSpikeTool(
        graphStore,
        (record) => sessionStore.saveDraft(record as Spike),
        (ids) => mintSpikeId(year, ids),
      ),
      createApproveSpikeTool(sessionStore),
    ]

    return new Pipeline({
      agent: fakeAgent,
      tools,
      presenter,
      humanIO,
      config: config.pipeline,
    })
  }

  return {
    config,
    agent: fakeAgent,
    graphStore,
    sessionStore,
    presenter,
    humanIO,
    spikeRunner: {} as never,
    parsers: {
      arc42: new Arc42Parser() as ParserPort,
      adr: new AdrParser() as ParserPort,
      codebase: new CodebaseParser() as ParserPort,
    },
    sessionService,
    createSessionPipeline,
  }
}

async function runNewSession(
  container: AppContainer,
  goal: string,
): Promise<{ completed: boolean; finalState: string }> {
  const { sessionService, sessionStore, presenter } = container

  const graph = await sessionService.loadGraph()
  const now = new Date().toISOString()
  const sessionState = SessionStateSchema.parse({
    state: 'SCOPING',
    decision_id: undefined,
    metadata: { goal, decisionType: 'architecture' },
    created_at: now,
    updated_at: now,
  })
  await sessionStore.saveState(sessionState)
  presenter.displayProgress('SCOPING')

  const pipeline = container.createSessionPipeline(graph)
  const sessionData: SessionData = {
    assumptions: 2,
    approvedSpikes: 1,
  }

  const result = await pipeline.run('SCOPING', sessionData)

  const updated: SessionStateRecord = {
    ...sessionState,
    state: result.finalState as SessionStateRecord['state'],
    updated_at: new Date().toISOString(),
    metadata: { goal, decisionType: 'architecture' },
  }
  await sessionStore.saveState(updated)

  if (result.completed) {
    presenter.display(
      'Pipeline reached commit state. Run "dve commit" to finalize.',
    )
  }

  return { completed: result.completed, finalState: result.finalState }
}

describe('Full init -> new -> commit cycle', () => {
  let tmpDir: string
  let projectDir: string
  let decisionsDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-cycle-${Date.now()}`)
    projectDir = resolve(tmpDir, 'project')
    decisionsDir = resolve(tmpDir, 'decisions')
    mkdirSync(tmpDir, { recursive: true })
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(decisionsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function setupProject(): void {
    writeFileSync(resolve(projectDir, 'arc42.md'), SAMPLE_ARC42)
    writeFileSync(resolve(projectDir, 'package.json'), SAMPLE_PACKAGE_JSON)
    const adrDir = resolve(projectDir, 'docs', 'adr')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(resolve(adrDir, '0001-use-postgres.md'), SAMPLE_ADR)
  }

  it('completes full init-new-commit cycle without errors', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Alice', ''])
    humanIO.setConfirms([true, false])

    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )

    const initResult = await runInit(container, projectDir)

    expect(initResult.arc42Parsed).toBe(true)
    expect(initResult.stackDetected).toBe(true)
    expect(initResult.adrsImported).toBe(1)
    expect(initResult.contextWritten).toContain('arc42')
    expect(initResult.contextWritten).toContain('stack')

    const newResult = await runNewSession(container, 'Choose caching strategy')
    expect(newResult.completed).toBe(true)
    expect(newResult.finalState).toBe('COMMIT')
    const commitResult = await runCommit(container)
    expect(commitResult.committed).toBe(true)
    expect(commitResult.decisionId).toMatch(/^DEC-\d{4}-\d{3}$/)
    expect(commitResult.recordsWritten).toBeGreaterThanOrEqual(1)
    expect(commitResult.signatoriesCount).toBe(1)
    expect(commitResult.sessionCleared).toBe(true)
  })

  it('persists records as valid YAML after commit', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Bob', ''])
    humanIO.setConfirms([true, false])

    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    await runNewSession(container, 'Choose database')

    const commitResult = await runCommit(container)
    expect(commitResult.committed).toBe(true)
    const recordsDir = resolve(decisionsDir, 'records')
    expect(existsSync(recordsDir)).toBe(true)
    const recordFiles = readdirSync(recordsDir).filter((f) =>
      f.endsWith('.yaml'),
    )
    expect(recordFiles.length).toBeGreaterThanOrEqual(1)
    const decisionFile = `${commitResult.decisionId}.yaml`
    expect(recordFiles).toContain(decisionFile)
    const content = readFileSync(resolve(recordsDir, decisionFile), 'utf-8')
    const parsed = yamlParse(content)
    expect(parsed.id).toMatch(/^DEC-\d{4}-\d{3}$/)
    expect(parsed.goal).toBe('Choose database')
    expect(parsed.status).toBe('validated')
    expect(parsed.commit_signatories).toBeDefined()
    expect(parsed.commit_signatories.length).toBe(1)
    expect(parsed.commit_signatories[0].name).toBe('Bob')
    expect(parsed.assumptions).toBeDefined()
    expect(parsed.arc42_sections_affected).toBeDefined()
  })

  it('writes arc42 and stack context during init', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses([])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )

    await runInit(container, projectDir)
    const arc42Path = resolve(decisionsDir, 'context', 'arc42.yaml')
    expect(existsSync(arc42Path)).toBe(true)
    const arc42Content = readFileSync(arc42Path, 'utf-8')
    const arc42Parsed = yamlParse(arc42Content)
    expect(arc42Parsed.sections).toBeDefined()
    expect(arc42Parsed.sections['introduction and goals']).toContain(
      'microservice',
    )

    const stackPath = resolve(decisionsDir, 'context', 'stack.yaml')
    expect(existsSync(stackPath)).toBe(true)
    const stackContent = readFileSync(stackPath, 'utf-8')
    const stackParsed = yamlParse(stackContent)
    expect(stackParsed.technologies).toBeDefined()
    expect(stackParsed.technologies).toContain('TypeScript')
  })

  it('imports ADRs during init and preserves them after commit', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Carol', ''])
    humanIO.setConfirms([true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    const initResult = await runInit(container, projectDir)
    expect(initResult.adrsImported).toBe(1)
    const recordsBefore = await container.graphStore.readRecords()
    expect(recordsBefore.length).toBe(1)
    expect(recordsBefore[0]!.goal).toContain('PostgreSQL')

    await runNewSession(container, 'Replace database')
    const commitResult = await runCommit(container)
    expect(commitResult.committed).toBe(true)
    const recordsAfter = await container.graphStore.readRecords()
    expect(recordsAfter.length).toBe(2)
    const newDecision = recordsAfter.find(
      (r) => r.id === commitResult.decisionId,
    )
    expect(newDecision).toBeDefined()
    expect(newDecision!.goal).toBe('Replace database')
  })

  it('clears session after successful commit', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Dave', ''])
    humanIO.setConfirms([true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    await runNewSession(container, 'Test goal')
    const commitResult = await runCommit(container)
    expect(commitResult.committed).toBe(true)
    expect(commitResult.sessionCleared).toBe(true)
    const state = await container.sessionStore.loadState()
    expect(state).toBeNull()
  })

  it('knowledge graph is queryable after commit', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Eve', ''])
    humanIO.setConfirms([true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    await runNewSession(container, 'Add caching')
    await runCommit(container)
    const graph = new KnowledgeGraph()
    const [assumptions, spikes, records] = await Promise.all([
      container.graphStore.readAssumptions(),
      container.graphStore.readSpikes(),
      container.graphStore.readRecords(),
    ])

    for (const a of assumptions) graph.addNode(a)
    for (const s of spikes) graph.addNode(s)
    for (const r of records) graph.addNode(r)
    const allNodes = graph.query(() => true)
    expect(allNodes.length).toBeGreaterThan(0)
  })

  it('handles multiple signatories in commit', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Alice', '', 'Bob', ''])
    humanIO.setConfirms([true, true, true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    await runNewSession(container, 'Refactor API')
    const commitResult = await runCommit(container)
    expect(commitResult.committed).toBe(true)
    expect(commitResult.signatoriesCount).toBe(2)
    const records = await container.graphStore.readRecords()
    const decision = records.find((r) => r.id === commitResult.decisionId)
    expect(decision!.commit_signatories.length).toBe(2)
    const names = decision!.commit_signatories.map((s) => s.name)
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
  })

  it('session state transitions through all pipeline states', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Frank', ''])
    humanIO.setConfirms([true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    const newResult = await runNewSession(container, 'Migrate to GraphQL')
    expect(newResult.completed).toBe(true)
    expect(newResult.finalState).toBe('COMMIT')
    const presenter = container.presenter as MockPresenter
    expect(presenter.messages.some((m) => m.includes('[SCOPING]'))).toBe(true)
    expect(presenter.messages.some((m) => m.includes('[DECOMPOSING]'))).toBe(
      true,
    )
    await runCommit(container)
  })

  it('produces valid YAML files that are git-trackable', async () => {
    setupProject()

    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Grace', ''])
    humanIO.setConfirms([true, false])
    const container = buildContainerWithFakeAgent(
      decisionsDir,
      humanIO,
      createAgentDrivingToCommit(),
    )
    await runInit(container, projectDir)
    await runNewSession(container, 'Add monitoring')
    await runCommit(container)
    const checkYamlFiles = (dir: string) => {
      if (!existsSync(dir)) return
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '.session') continue
          checkYamlFiles(fullPath)
        } else if (entry.name.endsWith('.yaml')) {
          const content = readFileSync(fullPath, 'utf-8')
          expect(() => yamlParse(content)).not.toThrow()
          expect(content.length).toBeGreaterThan(0)
        }
      }
    }
    checkYamlFiles(decisionsDir)
  })
})
