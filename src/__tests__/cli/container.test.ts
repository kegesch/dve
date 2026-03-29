import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createContainer } from '../../cli/container'
import type { DveConfig } from '../../cli/config'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'

function makeTestConfig(tmpDir: string): DveConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'test-api-key',
    decisionsDir: tmpDir,
  }
}

describe('createContainer', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `dve-test-container-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    for (const sub of [
      'records',
      'assumptions',
      'spikes',
      'context',
      '.session',
    ]) {
      mkdirSync(join(tmpDir, sub), { recursive: true })
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('wires all infrastructure adapters', () => {
    const container = createContainer(makeTestConfig(tmpDir))

    expect(container.agent).toBeDefined()
    expect(container.agent.id).toBe('openai')

    expect(container.graphStore).toBeDefined()
    expect(container.sessionStore).toBeDefined()
    expect(container.presenter).toBeDefined()
    expect(container.humanIO).toBeDefined()
    expect(container.spikeRunner).toBeDefined()
  })

  it('wires all parsers', () => {
    const container = createContainer(makeTestConfig(tmpDir))

    expect(container.parsers.arc42).toBeDefined()
    expect(container.parsers.adr).toBeDefined()
    expect(container.parsers.codebase).toBeDefined()
  })

  it('wires session service with correct deps', () => {
    const container = createContainer(makeTestConfig(tmpDir))

    expect(container.sessionService).toBeDefined()
    expect(container.graphStore).toBeDefined()
    expect(container.sessionStore).toBeDefined()
  })

  it('exposes config', () => {
    const config = makeTestConfig(tmpDir)
    const container = createContainer(config)

    expect(container.config).toBe(config)
  })

  it('createSessionPipeline returns a Pipeline', () => {
    const container = createContainer(makeTestConfig(tmpDir))
    const graph = new KnowledgeGraph()
    const pipeline = container.createSessionPipeline(graph)

    expect(pipeline).toBeDefined()
  })

  it('throws for unsupported provider', () => {
    const config: DveConfig = {
      ...makeTestConfig(tmpDir),
      provider: 'anthropic',
    }

    expect(() => createContainer(config)).toThrow(
      'Provider "anthropic" is not yet implemented',
    )
  })

  it('createSessionPipeline creates tools with graph', () => {
    const container = createContainer(makeTestConfig(tmpDir))
    const graph = new KnowledgeGraph()
    const pipeline = container.createSessionPipeline(graph)

    expect(pipeline).toBeDefined()
  })
})
