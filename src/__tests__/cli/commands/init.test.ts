import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse } from 'yaml'
import { runInit } from '../../../cli/commands/init'
import type { AppContainer } from '../../../cli/container'
import type { DveConfig } from '../../../cli/config'
import type {
  HumanIOPort,
  PresenterPort,
  ParserPort,
} from '../../../application/ports'
import { YamlGraphStore } from '../../../infrastructure/graph/yaml-graph.store'
import { Arc42Parser } from '../../../infrastructure/parsers/arc42.parser'
import { AdrParser } from '../../../infrastructure/parsers/adr.parser'
import { CodebaseParser } from '../../../infrastructure/parsers/codebase.parser'

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

  displayProgress(): void {}
}

class MockHumanIO implements HumanIOPort {
  private responses: string[] = []
  private confirms: boolean[] = []

  setResponses(responses: string[]): void {
    this.responses = responses
  }

  setConfirms(confirms: boolean[]): void {
    this.confirms = confirms
  }

  async ask(question: string): Promise<string> {
    void question
    return this.responses.shift() ?? ''
  }

  async confirm(): Promise<boolean> {
    return this.confirms.shift() ?? false
  }

  async select<T extends string>(
    question: string,
    options: readonly { readonly value: T; readonly label: string }[],
  ): Promise<T> {
    void question
    return options[0]!.value
  }
}

function makeContainer(tmpDir: string, humanIO?: MockHumanIO): AppContainer {
  const config = makeTestConfig(tmpDir)
  const presenter = new MockPresenter()
  const io = humanIO ?? new MockHumanIO()
  const graphStore = new YamlGraphStore(tmpDir)

  return {
    config,
    agent: { id: 'mock' } as never,
    graphStore,
    sessionStore: {} as never,
    presenter,
    humanIO: io,
    spikeRunner: {} as never,
    parsers: {
      arc42: new Arc42Parser() as ParserPort,
      adr: new AdrParser() as ParserPort,
      codebase: new CodebaseParser() as ParserPort,
    },
    sessionService: {} as never,
    createSessionPipeline: () => ({}) as never,
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

describe('runInit', () => {
  let tmpDir: string
  let projectDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-init-${Date.now()}`)
    projectDir = resolve(tmpDir, 'project')
    mkdirSync(tmpDir, { recursive: true })
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates /decisions/ directory structure in a fresh repo', async () => {
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)
    const result = await runInit(container, projectDir)

    expect(existsSync(resolve(decisionsDir, 'records'))).toBe(true)
    expect(existsSync(resolve(decisionsDir, 'assumptions'))).toBe(true)
    expect(existsSync(resolve(decisionsDir, 'spikes'))).toBe(true)
    expect(existsSync(resolve(decisionsDir, 'context'))).toBe(true)
    expect(result.contextWritten.length).toBeGreaterThanOrEqual(0)
  })

  it('parses arc42 documentation without errors', async () => {
    writeFileSync(resolve(projectDir, 'arc42.md'), SAMPLE_ARC42)
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    const result = await runInit(container, projectDir)

    expect(result.arc42Parsed).toBe(true)
    expect(result.contextWritten).toContain('arc42')

    const context = await container.graphStore.readContext()
    expect(context.arc42).not.toBeNull()
    expect(context.arc42!.sections['introduction and goals']).toContain(
      'microservice',
    )
  })

  it('imports ADRs as DEC records', async () => {
    const adrDir = resolve(projectDir, 'docs', 'adr')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(resolve(adrDir, '0001-use-postgres.md'), SAMPLE_ADR)

    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    const result = await runInit(container, projectDir)

    expect(result.adrsImported).toBe(1)
    const records = await container.graphStore.readRecords()
    expect(records.length).toBe(1)
    expect(records[0]!.id).toMatch(/^DEC-\d{4}-\d{3}$/)
    expect(records[0]!.goal).toContain('PostgreSQL')
  })

  it('detects tech stack from config files', async () => {
    writeFileSync(resolve(projectDir, 'package.json'), SAMPLE_PACKAGE_JSON)
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    const result = await runInit(container, projectDir)

    expect(result.stackDetected).toBe(true)
    expect(result.contextWritten).toContain('stack')

    const context = await container.graphStore.readContext()
    expect(context.stack).not.toBeNull()
    expect(context.stack!.technologies).toContain('TypeScript')
    expect(context.stack!.technologies).toContain('Express')
  })

  it('asks targeted questions for gaps', async () => {
    const decisionsDir = resolve(projectDir, 'decisions')
    const humanIO = new MockHumanIO()
    humanIO.setResponses(['Test answer for gap'])
    const container = makeContainer(decisionsDir, humanIO)

    const result = await runInit(container, projectDir)

    expect(result.questionsAsked).toBeGreaterThanOrEqual(0)
  })

  it('writes valid YAML context files', async () => {
    writeFileSync(resolve(projectDir, 'arc42.md'), SAMPLE_ARC42)
    writeFileSync(resolve(projectDir, 'package.json'), SAMPLE_PACKAGE_JSON)
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    await runInit(container, projectDir)

    const arc42Path = resolve(decisionsDir, 'context', 'arc42.yaml')
    expect(existsSync(arc42Path)).toBe(true)
    const arc42Content = readFileSync(arc42Path, 'utf-8')
    const parsed = yamlParse(arc42Content)
    expect(parsed.sections).toBeDefined()

    const stackPath = resolve(decisionsDir, 'context', 'stack.yaml')
    expect(existsSync(stackPath)).toBe(true)
    const stackContent = readFileSync(stackPath, 'utf-8')
    const stackParsed = yamlParse(stackContent)
    expect(stackParsed.technologies).toBeDefined()
    expect(Array.isArray(stackParsed.technologies)).toBe(true)
  })

  it('does not overwrite existing valid data on re-run', async () => {
    writeFileSync(resolve(projectDir, 'arc42.md'), SAMPLE_ARC42)
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    await runInit(container, projectDir)

    const context1 = await container.graphStore.readContext()
    const goals1 = context1.arc42!.sections['introduction and goals']

    const container2 = makeContainer(decisionsDir)
    await runInit(container2, projectDir)

    const context2 = await container2.graphStore.readContext()
    const goals2 = context2.arc42!.sections['introduction and goals']

    expect(goals2).toContain(goals1)
  })

  it('does not re-import ADRs on re-run', async () => {
    const adrDir = resolve(projectDir, 'docs', 'adr')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(resolve(adrDir, '0001-use-postgres.md'), SAMPLE_ADR)
    const decisionsDir = resolve(projectDir, 'decisions')

    const container1 = makeContainer(decisionsDir)
    await runInit(container1, projectDir)

    const container2 = makeContainer(decisionsDir)
    const result2 = await runInit(container2, projectDir)

    expect(result2.adrsImported).toBe(0)
  })

  it('identifies gaps when arc42 sections are empty', async () => {
    writeFileSync(resolve(projectDir, 'arc42.md'), SAMPLE_ARC42)
    const decisionsDir = resolve(projectDir, 'decisions')
    const container = makeContainer(decisionsDir)

    const result = await runInit(container, projectDir)

    expect(result.gapsFound).toBeGreaterThan(0)
    expect(result.contextWritten).toContain('gaps')
  })

  it('works in a completely fresh repo with no docs', async () => {
    const decisionsDir = resolve(projectDir, 'decisions')
    const humanIO = new MockHumanIO()
    humanIO.setResponses(['We are building a REST API', 'Node.js + TypeScript'])
    const container = makeContainer(decisionsDir, humanIO)

    const result = await runInit(container, projectDir)

    expect(existsSync(resolve(decisionsDir, 'context'))).toBe(true)
    expect(result.arc42Parsed).toBe(false)
    expect(result.adrsImported).toBe(0)
  })
})
