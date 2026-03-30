import type {
  AgentPort,
  ToolPort,
  GraphStorePort,
  SessionStorePort,
  SpikeRunnerPort,
  ParserPort,
  PresenterPort,
  HumanIOPort,
} from '../application/ports'
import type { Assumption, Spike } from '../domain/types'

import { OpenAIAgent } from '../infrastructure/agent/openai.agent'
import {
  createQueryGraphTool,
  createReadFileTool,
  createAskHumanTool,
  createWriteAssumptionTool,
  createProposeSpikeTool,
  createExecuteSpikeTool,
  createApproveSpikeTool,
  createModifySpikeTool,
  createDropSpikeTool,
  createDeferSpikeTool,
} from '../infrastructure/agent/tool-dispatcher'
import { YamlGraphStore } from '../infrastructure/graph/yaml-graph.store'
import { FileSessionStore } from '../infrastructure/store/file-session.store'
import { CliPresenter } from '../infrastructure/presenter/cli.presenter'
import { CliHumanIO } from '../infrastructure/human-io/cli-human.io'
import { DockerSpikeRunner } from '../infrastructure/sandbox/docker-spike.runner'
import { AdrParser } from '../infrastructure/parsers/adr.parser'
import { Arc42Parser } from '../infrastructure/parsers/arc42.parser'
import { CodebaseParser } from '../infrastructure/parsers/codebase.parser'

import { SessionService } from '../application/session/session-service'
import { Pipeline } from '../application/engine/pipeline'

import { KnowledgeGraph } from '../domain/graph/knowledge-graph'
import { mintAssumptionId, mintSpikeId } from '../domain/id/id-minter'

import type { DveConfig } from './config'

export interface AppContainer {
  readonly config: DveConfig
  readonly agent: AgentPort
  readonly graphStore: GraphStorePort
  readonly sessionStore: SessionStorePort
  readonly presenter: PresenterPort
  readonly humanIO: HumanIOPort
  readonly spikeRunner: SpikeRunnerPort
  readonly parsers: {
    readonly arc42: ParserPort
    readonly adr: ParserPort
    readonly codebase: ParserPort
  }
  readonly sessionService: SessionService
  createSessionPipeline(graph: KnowledgeGraph): Pipeline
}

export function createContainer(config: DveConfig): AppContainer {
  const agent = createAgent(config)

  const graphStore = new YamlGraphStore(config.decisionsDir)
  const sessionStore = new FileSessionStore(config.decisionsDir)

  const presenter = new CliPresenter()
  const humanIO = new CliHumanIO()

  const spikeRunner = new DockerSpikeRunner({
    socketPath: config.dockerSocket,
    defaultImage: config.dockerImage,
    artefactsBaseDir: config.artefactsDir,
  })

  const parsers = {
    arc42: new Arc42Parser() as ParserPort,
    adr: new AdrParser() as ParserPort,
    codebase: new CodebaseParser() as ParserPort,
  }

  const sessionService = new SessionService(sessionStore, graphStore)

  function createSessionPipeline(graph: KnowledgeGraph): Pipeline {
    const tools = buildTools(
      graph,
      graphStore,
      sessionStore,
      humanIO,
      spikeRunner,
      config,
    )

    return new Pipeline({
      agent,
      tools,
      presenter,
      humanIO,
      config: config.pipeline,
    })
  }

  return {
    config,
    agent,
    graphStore,
    sessionStore,
    presenter,
    humanIO,
    spikeRunner,
    parsers,
    sessionService,
    createSessionPipeline,
  }
}

function createAgent(config: DveConfig): AgentPort {
  if (config.provider === 'openai') {
    return new OpenAIAgent({
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }
  throw new Error(`Provider "${config.provider}" is not yet implemented`)
}

function buildTools(
  graph: KnowledgeGraph,
  graphStore: GraphStorePort,
  sessionStore: SessionStorePort,
  humanIO: HumanIOPort,
  spikeRunner: SpikeRunnerPort,
  config: DveConfig,
): ToolPort[] {
  const year = new Date().getFullYear().toString()

  return [
    createQueryGraphTool(graph),
    createReadFileTool(config.decisionsDir),
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
    createExecuteSpikeTool(spikeRunner),
    createApproveSpikeTool(sessionStore),
    createModifySpikeTool(sessionStore),
    createDropSpikeTool(sessionStore),
    createDeferSpikeTool(sessionStore),
  ]
}
