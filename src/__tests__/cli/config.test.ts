import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../../cli/config'

describe('loadConfig', () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of [
      'DVE_API_KEY',
      'DVE_PROVIDER',
      'DVE_MODEL',
      'DVE_DECISIONS_DIR',
      'DVE_BASE_URL',
      'DVE_DOCKER_SOCKET',
      'DVE_DOCKER_IMAGE',
      'DVE_ARTEFACTS_DIR',
    ]) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val !== undefined) {
        process.env[key] = val
      } else {
        delete process.env[key]
      }
    }
  })

  it('uses defaults when no config file or env vars', () => {
    process.env.DVE_API_KEY = 'test-key'
    const config = loadConfig()
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.apiKey).toBe('test-key')
    expect(config.decisionsDir).toBe(resolve(process.cwd(), './decisions'))
  })

  it('throws when no API key is set', () => {
    expect(() => loadConfig()).toThrow('API key is required')
  })

  it('reads from env vars with higher priority than defaults', () => {
    process.env.DVE_API_KEY = 'env-key'
    process.env.DVE_MODEL = 'gpt-3.5-turbo'
    process.env.DVE_PROVIDER = 'openai'
    const config = loadConfig()
    expect(config.apiKey).toBe('env-key')
    expect(config.model).toBe('gpt-3.5-turbo')
  })

  it('reads from .dve.yaml config file', () => {
    const tmpDir = resolve(tmpdir(), `dve-test-config-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.dve.yaml')
    writeFileSync(
      configPath,
      [
        'provider: openai',
        'model: gpt-4o-mini',
        'apiKey: file-key',
        'decisionsDir: ./my-decisions',
        'docker:',
        '  socketPath: /var/run/docker.sock',
        '  defaultImage: node:20',
      ].join('\n'),
    )

    const originalCwd = process.cwd()
    try {
      process.chdir(tmpDir)
      const config = loadConfig()
      expect(config.apiKey).toBe('file-key')
      expect(config.model).toBe('gpt-4o-mini')
      expect(config.decisionsDir).toBe(resolve(tmpDir, './my-decisions'))
      expect(config.dockerSocket).toBe('/var/run/docker.sock')
      expect(config.dockerImage).toBe('node:20')
    } finally {
      process.chdir(originalCwd)
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('CLI overrides take precedence over env vars', () => {
    process.env.DVE_API_KEY = 'env-key'
    process.env.DVE_MODEL = 'env-model'
    const config = loadConfig({ model: 'override-model' })
    expect(config.model).toBe('override-model')
  })

  it('CLI overrides take precedence over config file', () => {
    const tmpDir = resolve(tmpdir(), `dve-test-override-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      resolve(tmpDir, '.dve.yaml'),
      'model: file-model\napiKey: file-key\n',
    )

    const originalCwd = process.cwd()
    try {
      process.chdir(tmpDir)
      const config = loadConfig({ model: 'cli-model' })
      expect(config.model).toBe('cli-model')
    } finally {
      process.chdir(originalCwd)
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('env vars take precedence over config file', () => {
    const tmpDir = resolve(tmpdir(), `dve-test-envprio-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      resolve(tmpDir, '.dve.yaml'),
      'model: file-model\napiKey: file-key\n',
    )

    process.env.DVE_API_KEY = 'env-key'
    process.env.DVE_MODEL = 'env-model'

    const originalCwd = process.cwd()
    try {
      process.chdir(tmpDir)
      const config = loadConfig()
      expect(config.apiKey).toBe('env-key')
      expect(config.model).toBe('env-model')
    } finally {
      process.chdir(originalCwd)
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves decisionsDir to absolute path', () => {
    process.env.DVE_API_KEY = 'test-key'
    process.env.DVE_DECISIONS_DIR = './custom-dir'
    const config = loadConfig()
    expect(config.decisionsDir).toBe(resolve(process.cwd(), './custom-dir'))
  })

  it('reads pipeline config from file', () => {
    const tmpDir = resolve(tmpdir(), `dve-test-pipeline-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      resolve(tmpDir, '.dve.yaml'),
      [
        'apiKey: test-key',
        'pipeline:',
        '  maxAgentIterations: 100',
        '  maxPipelineLoops: 200',
        '  loopVisitThreshold: 5',
      ].join('\n'),
    )

    const originalCwd = process.cwd()
    try {
      process.chdir(tmpDir)
      const config = loadConfig()
      expect(config.pipeline?.maxAgentIterations).toBe(100)
      expect(config.pipeline?.maxPipelineLoops).toBe(200)
      expect(config.pipeline?.loopVisitThreshold).toBe(5)
    } finally {
      process.chdir(originalCwd)
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws for unsupported provider', () => {
    process.env.DVE_API_KEY = 'test-key'
    expect(() => loadConfig({ provider: 'gemini' })).toThrow(
      'Unsupported provider',
    )
  })

  it('accepts anthropic provider', () => {
    process.env.DVE_API_KEY = 'test-key'
    const config = loadConfig({ provider: 'anthropic' })
    expect(config.provider).toBe('anthropic')
  })
})
