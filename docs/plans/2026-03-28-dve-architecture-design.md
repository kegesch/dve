# DVE Architecture Design

**Date**: 2026-03-28
**Status**: Approved
**Brief version**: v0.4

## Summary

The Decision Validation Engine (DVE) is a CLI tool that lives in the repository. It uses AI to decompose architectural and product decisions, stress-test assumptions across three classes (technical, environmental, domain), run isolated spikes to validate high-risk assumptions, and enforce explicit team sign-off before implementation begins.

## Key Architecture Decisions

### AD-1: AI as Reasoning Engine

The engine owns all orchestration, state management, graph queries, file I/O, and CLI flow. The AI is called as a stateless tool-using agent for reasoning tasks. The engine feeds structured context to the agent and the agent calls engine-provided tools to interact with the knowledge graph, files, and the human.

**Rationale**: Keeps the core deterministic and testable. The AI enhances reasoning within each stage but cannot bypass validation or skip steps.

### AD-2: State Machine Session Model

A `dve new` session is modeled as a finite state machine. The AI agent drives transitions between states, but the engine validates all transitions against legal rules and prerequisites. Backward transitions are allowed (e.g., stress-testing can loop back to decomposition if a missing requirement is discovered), but the engine tracks visit counts and can flag loops.

**States**:

| State | Purpose |
|-------|---------|
| `SCOPING` | Gather decision context, check stop signals |
| `DECOMPOSING` | Separate requirements from assumptions |
| `STRESS_TESTING` | Apply stressors, rank risks, generate killing questions |
| `SPIKE_PLANNING` | Define spike proposals for high-risk assumptions |
| `SPIKE_REVIEW` | Human gates spikes (approve/modify/drop/defer) |
| `SPIKE_EXECUTING` | Run approved spikes in Docker sandbox |
| `COMMIT` | Generate commit brief, collect sign-offs |

### AD-3: File-Based Session Storage

Session state, conversation history, and draft records are stored in `/decisions/.session/` as YAML and JSONL files. This directory is gitignored. On `dve commit`, drafts move to their permanent directories and `.session/` is deleted. On crash, `dve resume` reads the session state and replays conversation history.

**Rationale**: No SQLite dependency. Everything is files. Simpler mental model, fewer dependencies, consistent with the repo-native philosophy.

### AD-4: Clean Architecture

The codebase follows Clean Architecture with four layers. Dependencies point inward only.

```
CLI (entry point) → Infrastructure (adapters) → Application (use cases + ports) → Domain (pure logic)
```

- **Domain** has zero external dependencies. Pure TypeScript types, state machine logic, knowledge graph queries, ID generation.
- **Application** defines ports (interfaces) and use cases. Imports only from Domain.
- **Infrastructure** implements ports with concrete adapters (OpenAI, Docker, YAML files, terminal I/O).
- **CLI** is the composition root that wires everything together.

### AD-5: Provider-Agnostic Agent Interface

The agent interface is defined as an application port. Provider adapters (OpenAI, Anthropic, opencode) implement this port. The engine never knows which provider is running.

### AD-6: Docker Spike Sandbox

Spikes run in throwaway Docker containers with strict isolation: read-only filesystem except mounted volume, no network unless approved, memory/CPU limits, time-boxed with hard kill. The project source is never mounted.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Runtime | Node.js 22+ |
| CLI Framework | Cliffy |
| Package Manager | pnpm |
| Agent SDK | Vercel AI SDK |
| Schema Validation | Zod |
| YAML | yaml (eijemerv) |
| Docker API | dockerode |
| Container Runtime | Docker |
| Build | tsup |
| Test | vitest |
| Lint | eslint + prettier |
| Typecheck | tsc --noEmit |

## Storage Architecture

```
/decisions/
  .session/                  # gitignored, ephemeral
    state.yaml               # current state machine state + metadata
    conversation.jsonl        # append-only conversation log
    drafts/                   # draft records not yet committed
      ASM-draft-001.yaml
  records/                   # Layer 1: DEC-YYYY-NNN.yaml
  assumptions/               # Layer 2: ASM-YYYY-NNN.yaml
  spikes/                    # SPK-YYYY-NNN.yaml
    artefacts/               # throwaway spike code
  context/                   # arc42.yaml, stack.yaml, gaps.yaml
```

- YAML files are the single source of truth
- In-memory knowledge graph is loaded from YAML on session start
- Graph mutations during a session are held as drafts in `.session/`
- On commit, drafts are written to permanent YAML files
- Knowledge graph rebuilds from files on next session start

## Module Structure

```
src/
  domain/                         # Pure business logic, zero dependencies
    models/                       # Value objects and entities
      decision.ts
      assumption.ts
      spike.ts
      context.ts
      session.ts
    graph/
      knowledge-graph.ts          # Graph interface + in-memory implementation
      types.ts
    state-machine/
      states.ts                   # State enum, transition rules
      machine.ts                  # Pure state transition logic
    validation/
      schemas.ts                  # Zod schemas for all record types
    id/
      id-minter.ts                # ID generation: DEC-YYYY-NNN etc.
    types.ts

  application/                    # Use cases and port definitions
    session/
      session-service.ts
    engine/
      pipeline.ts                 # State machine + agent loop orchestration
      decomposition.ts
      stress-testing.ts
      spike-planning.ts
      commit-gate.ts
    graph/
      graph-service.ts
    init/
      init-service.ts
    ports/                        # Interfaces the application needs
      agent.port.ts
      tool.port.ts
      store.port.ts
      graph-store.port.ts
      spike-runner.port.ts
      parser.port.ts
      presenter.port.ts
      human-io.port.ts

  infrastructure/                 # Port implementations
    agent/
      openai.agent.ts
      anthropic.agent.ts
      opencode.agent.ts
      tool-dispatcher.ts
    store/
      file-session.store.ts
    graph/
      yaml-graph.store.ts
    sandbox/
      docker-spike.runner.ts
    parsers/
      arc42.parser.ts
      adr.parser.ts
      codebase.parser.ts
    presenter/
      cli.presenter.ts
    human-io/
      cli-human.io.ts

  cli/                            # Composition root + entry point
    commands/
      init.ts
      new.ts
      spike.ts
      commit.ts
      resume.ts
    container.ts                  # Dependency injection wiring
    index.ts
```

## Agent Interface

```typescript
interface Agent {
  id: string
  name: string

  run(params: {
    systemPrompt: string
    messages: ConversationMessage[]
    tools: ToolDefinition[]
    maxIterations: number
  }): AsyncGenerator<AgentEvent>
}

type AgentEvent =
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'text'; content: string }
  | { type: 'transition'; target: SessionState }
  | { type: 'done'; summary: string }

interface ToolDefinition {
  name: string
  description: string
  parameters: ZodSchema
}
```

## Engine-Provided Tools (Available to Agent per State)

| Tool | Available in states | Description |
|------|-------------------|-------------|
| `queryGraph` | All | Query the knowledge graph for assumptions, implication chains, stop signals |
| `readFile` | All | Read files from the project (codebase analysis) |
| `askHuman` | All | Ask the human a question and wait for response |
| `writeAssumption` | DECOMPOSING, STRESS_TESTING, SPIKE_EXECUTING | Create or update a draft assumption |
| `updateRiskRanking` | STRESS_TESTING | Update risk ranking for assumptions |
| `proposeSpike` | SPIKE_PLANNING, SPIKE_EXECUTING | Propose a new spike (requires human approval) |
| `approveSpike` | SPIKE_REVIEW | Mark a spike as approved |
| `modifySpike` | SPIKE_REVIEW | Modify spike scope before approval |
| `dropSpike` | SPIKE_REVIEW | Drop a spike, accept assumption as conscious bet |
| `executeSpike` | SPIKE_EXECUTING | Run a spike in Docker sandbox |
| `transition` | All | Propose transition to a different state |
| `generateBrief` | COMMIT | Generate the commit brief |
| `writeRecord` | COMMIT | Write final records to permanent YAML |

## Spike Execution Model

1. Agent proposes spike via `proposeSpike` tool
2. Human reviews via `dve spike review` (approve/modify/drop/defer)
3. Engine generates spike code in temp directory
4. Docker container runs with:
   - Base image matching project tech stack
   - Spike code mounted as volume
   - Network isolated by default
   - Memory and CPU limits
   - Hard time-box kill
5. Agent analyzes output, produces yes/no/inconclusive
6. Artefacts optionally preserved in `/decisions/spikes/artefacts/`
7. Container and temp dir cleaned up

## Knowledge Graph

An in-memory directed graph. Nodes are ASMs, DECs, SPKs. Edges are explicit references between records.

**Key queries:**
- Find invalidated assumptions by tag (stop signal type 1)
- Find unvalidated bets by tag
- Traverse implication chains (ASM → ASM links)
- Get all assumptions for a decision
- Find assumptions relevant to a new decision's domain

**Lifecycle:**
- Loaded from YAML files on session start
- Mutated in memory during session (drafts held in `.session/`)
- Committed to YAML files on `dve commit`

## CLI Commands

| Command | Description |
|---------|-------------|
| `dve init` | Build persistent context from existing docs, ADRs, codebase |
| `dve new` | Start decision session (full state machine loop) |
| `dve spike review` | Human gate for proposed spikes |
| `dve commit` | Commit gate with sign-off collection |
| `dve resume` | Resume interrupted session |
