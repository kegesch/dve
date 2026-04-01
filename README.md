# DVE — Decision Validation Engine

Validates architectural decisions before implementation. Uses AI-powered analysis to surface assumptions, run stress tests, and execute spikes — so you commit decisions with evidence, not guesswork.

## Installation

Requires [Bun](https://bun.sh/) >= 1.2.

```bash
git clone git@github.com:kegesch/dve.git
cd dve
bun install
bun run build
```

This produces a standalone `dve.exe` (or `dve` on Linux/macOS) binary.

## Quick Start

```bash
# 1. Set your API key
export DVE_API_KEY="sk-..."

# 2. Initialize context from your project's docs and code
dve init

# 3. Start a decision validation session
dve new "Should we migrate from REST to gRPC?"

# 4. If interrupted, resume later
dve resume

# 5. Commit the validated decision
dve commit
```

## Commands

### `dve init`

Builds persistent context from your project's architecture documentation, ADRs, and codebase.

What it reads:

- **arc42 / architecture docs** — parses sections from `arc42.md`, `architecture.md`, or `docs/arc42.md`
- **ADRs** — imports records from `docs/adr/`, `adr/`, or similar directories
- **Config files** — detects tech stack from `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.

It creates a `decisions/` directory structure:

```
decisions/
  records/       # Validated decision records (YAML)
  assumptions/   # Assumption records (YAML)
  spikes/        # Spike definitions and results (YAML)
  context/       # Parsed arc42, stack, and gap context (YAML)
  .session/      # Active session state (gitignored, cleared on commit)
```

For any gaps found in the architecture docs, `dve init` prompts you to fill them in interactively.

### `dve new [goal]`

Starts an interactive decision validation session. The AI agent drives through these states:

```
SCOPING → DECOMPOSING → STRESS_TESTING → SPIKE_PLANNING → SPIKE_REVIEW → SPIKE_EXECUTING → COMMIT
```

The agent may loop back to earlier states (e.g., from `STRESS_TESTING` back to `DECOMPOSING`) to refine assumptions. Loop detection prevents infinite cycles (default threshold: 3 visits per state).

Before starting, DVE checks the knowledge graph for **stop signals** — assumptions that would be invalidated by the proposed decision. If found, you're warned and asked to confirm before proceeding.

You can provide the goal inline or be prompted for it:

```bash
dve new "Should we adopt event sourcing?"
```

Sessions can be interrupted with Ctrl+C and resumed later.

### `dve commit`

Finalizes a validated decision. Requires the session to be in `COMMIT` state.

The commit process:

1. Displays a **commit brief** — summary of validated/invalidated assumptions and accepted bets
2. Lists spike results if any were executed
3. Shows **accepted bets ranked by risk** (highest risk first)
4. Collects **sign-offs** — each signatory must acknowledge and accept the open bets
5. Writes all records (decision, assumptions, spikes) to the `decisions/` directory
6. Clears the session state
7. Suggests arc42 sections that may need updating

At least one signatory is required. If any signatory declines, the commit is aborted.

### `dve resume`

Resumes an interrupted or paused session. Shows a summary of the session state (goal, assumptions drafted, spikes drafted, conversation turns) and asks for confirmation before continuing.

If the session is already at `COMMIT` state, it directs you to run `dve commit` instead.

You can also choose to discard the session and start fresh.

## Configuration

### `.dve.yaml` (project root)

```yaml
provider: openai # AI provider: openai | anthropic
model: gpt-4o # Model name
apiKey: sk-... # API key (prefer env var instead)
baseURL: https://... # Custom API base URL
decisionsDir: ./decisions # Override decisions directory
docker:
  socketPath: /var/run/docker.sock
  defaultImage: dve-spike:latest
  artefactsBaseDir: ./artefacts
pipeline:
  maxAgentIterations: 50
  maxPipelineLoops: 10
  loopVisitThreshold: 3
```

### Environment Variables

| Variable            | Description                           | Default       |
| ------------------- | ------------------------------------- | ------------- |
| `DVE_API_KEY`       | API key (required)                    | —             |
| `DVE_PROVIDER`      | AI provider (`openai` or `anthropic`) | `openai`      |
| `DVE_MODEL`         | Model name                            | `gpt-4o`      |
| `DVE_BASE_URL`      | Custom API base URL                   | —             |
| `DVE_DECISIONS_DIR` | Override decisions directory          | `./decisions` |
| `DVE_DOCKER_SOCKET` | Docker socket path                    | —             |
| `DVE_DOCKER_IMAGE`  | Default Docker image for spikes       | —             |
| `DVE_ARTEFACTS_DIR` | Base directory for spike artefacts    | —             |

### CLI Flags

```
--provider <provider>     AI provider (overrides config)
--model <model>           Model name (overrides config)
--decisions-dir <dir>     Override decisions directory
```

## Knowledge Graph Directory Structure

```
decisions/
├── records/              # Decision records (DEC-YYYY-NNN)
│   └── DEC-2026-001.yaml
├── assumptions/          # Assumption records (ASM-YYYY-NNN)
│   └── ASM-2026-001.yaml
├── spikes/               # Spike records (SPK-YYYY-NNN)
│   └── SPK-2026-001.yaml
├── context/              # Parsed project context
│   ├── arc42.yaml
│   ├── stack.yaml
│   └── gaps.yaml
└── .session/             # Active session (gitignored)
    ├── state.yaml
    ├── conversation.jsonl
    └── drafts.yaml
```

ID formats:

- **Decisions**: `DEC-YYYY-NNN` (e.g., `DEC-2026-001`)
- **Assumptions**: `ASM-YYYY-NNN`
- **Spikes**: `SPK-YYYY-NNN`

## Architecture

Clean architecture with dependencies pointing inward only:

```
CLI → Infrastructure → Application → Domain
```

The Domain layer has zero external dependencies. The AI agent is used as a stateless reasoning tool — the engine orchestrates the session state machine, and the agent drives transitions.

For the full architecture design, see [`docs/plans/2026-03-28-dve-architecture-design.md`](docs/plans/2026-03-28-dve-architecture-design.md).

## Development

```bash
bun install            # Install dependencies
bun run dev            # Run in dev mode with watch
bun test               # Run tests
bun run lint           # Lint with ESLint
bun run typecheck      # Type check with TypeScript
bun run build          # Build standalone binary
```

## License

MIT
