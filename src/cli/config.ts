import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface DveConfig {
  readonly provider: 'openai' | 'anthropic'
  readonly model: string
  readonly apiKey: string
  readonly baseURL?: string
  readonly decisionsDir: string
  readonly dockerSocket?: string
  readonly dockerImage?: string
  readonly artefactsDir?: string
  readonly pipeline?: {
    readonly maxAgentIterations?: number
    readonly maxPipelineLoops?: number
    readonly loopVisitThreshold?: number
  }
}

interface DveConfigFile {
  readonly provider?: string
  readonly model?: string
  readonly apiKey?: string
  readonly baseURL?: string
  readonly decisionsDir?: string
  readonly docker?: {
    readonly socketPath?: string
    readonly defaultImage?: string
    readonly artefactsBaseDir?: string
  }
  readonly pipeline?: {
    readonly maxAgentIterations?: number
    readonly maxPipelineLoops?: number
    readonly loopVisitThreshold?: number
  }
}

const DEFAULTS: Omit<DveConfig, 'apiKey'> = {
  provider: 'openai',
  model: 'gpt-4o',
  decisionsDir: './decisions',
}

export function loadConfig(overrides?: {
  provider?: string
  model?: string
  decisionsDir?: string
}): DveConfig {
  let fileConfig: DveConfigFile = {}

  const configPath = resolve(process.cwd(), '.dve.yaml')
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8')
    fileConfig = parseYaml(raw) as DveConfigFile
  }

  const provider = resolveProvider(
    overrides?.provider ?? process.env.DVE_PROVIDER ?? fileConfig.provider,
  )

  const model =
    overrides?.model ??
    process.env.DVE_MODEL ??
    fileConfig.model ??
    DEFAULTS.model

  const apiKey = process.env.DVE_API_KEY ?? fileConfig.apiKey ?? ''

  if (!apiKey) {
    throw new Error(
      'API key is required. Set DVE_API_KEY env var or apiKey in .dve.yaml',
    )
  }

  const decisionsDir =
    overrides?.decisionsDir ??
    process.env.DVE_DECISIONS_DIR ??
    fileConfig.decisionsDir ??
    DEFAULTS.decisionsDir

  return {
    provider,
    model,
    apiKey,
    baseURL: fileConfig.baseURL ?? process.env.DVE_BASE_URL,
    decisionsDir: resolve(process.cwd(), decisionsDir),
    dockerSocket:
      fileConfig.docker?.socketPath ?? process.env.DVE_DOCKER_SOCKET,
    dockerImage:
      fileConfig.docker?.defaultImage ?? process.env.DVE_DOCKER_IMAGE,
    artefactsDir:
      fileConfig.docker?.artefactsBaseDir ?? process.env.DVE_ARTEFACTS_DIR,
    pipeline: fileConfig.pipeline,
  }
}

function resolveProvider(value?: string): 'openai' | 'anthropic' {
  if (!value) return DEFAULTS.provider as 'openai' | 'anthropic'
  const normalized = value.toLowerCase()
  if (normalized === 'openai' || normalized === 'anthropic') return normalized
  throw new Error(
    `Unsupported provider: "${value}". Supported: openai, anthropic`,
  )
}
