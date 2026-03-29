# DVE Implementation Plan

## Phases

### Phase 0: Project Scaffolding
Set up the TypeScript project with all tooling, build, and test infrastructure.

**Issues:**
- [#1] Scaffold TypeScript project with pnpm, tsup, vitest, eslint, prettier
- [#2] Define Zod schemas for all domain models (DEC, ASM, SPK, Context, Session)
- [#3] Implement domain types and ID minting (DEC-YYYY-NNN, ASM-YYYY-NNN, SPK-YYYY-NNN)

### Phase 1: Domain Layer (Pure Logic)
Build the innermost layer with zero external dependencies. Fully testable in isolation.

**Issues:**
- [#4] Implement state machine (states, transition rules, validation logic)
- [#5] Implement in-memory knowledge graph (load nodes, edges, queries)
- [#6] Implement knowledge graph queries (stop signals, implication chains, relevance search)

### Phase 2: Application Layer (Ports & Use Cases)
Define all port interfaces and implement use cases that orchestrate domain objects.

**Issues:**
- [#7] Define application port interfaces (Agent, Store, GraphStore, SpikeRunner, Parser, Presenter, HumanIO, Tool)
- [#8] Implement session service (start, resume, end session, state persistence)
- [#9] Implement pipeline orchestrator (state machine + agent loop integration)
- [#10] Implement engine use cases (decomposition, stress-testing, spike-planning, commit-gate)

### Phase 3: Infrastructure Layer (Adapters)
Implement all ports with concrete adapters.

**Issues:**
- [#11] Implement file-based session store (YAML state, JSONL conversation, draft records)
- [#12] Implement YAML graph store (read/write YAML record files, directory structure management)
- [#13] Implement CLI presenter and human-IO (Cliffy interactive prompts, formatted output)
- [#14] Implement agent tool dispatcher (route tool calls to use cases, validate args)
- [#15] Implement OpenAI agent adapter (Vercel AI SDK, function calling, streaming)
- [#16] Implement arc42 parser (parse markdown into structured context)
- [#17] Implement ADR parser (parse Nygard ADR format into DEC records)
- [#18] Implement codebase parser (infer tech stack from package files, build config)
- [#19] Implement Docker spike runner (dockerode, container lifecycle, isolation, timeboxing)

### Phase 4: CLI (Composition Root)
Wire everything together and implement the CLI commands.

**Issues:**
- [#20] Implement dependency injection container (wire ports to adapters)
- [#21] Implement `dve init` command (build context from existing docs, ADRs, codebase)
- [#22] Implement `dve new` command (start decision session with full state machine loop)
- [#23] Implement `dve spike review` command (human gate for spike proposals)
- [#24] Implement `dve commit` command (generate brief, collect sign-offs, write records)
- [#25] Implement `dve resume` command (restore interrupted session)

### Phase 5: Integration & Polish
End-to-end testing and documentation.

**Issues:**
- [#26] Integration test: full `dve init` + `dve new` + `dve commit` cycle
- [#27] Integration test: spike execution lifecycle with Docker
- [#28] Integration test: session crash and resume
- [#29] Stress-test validation against the three brief examples (Spring AS, PKI card, onboarding)
- [#30] README and usage documentation

## Dependencies

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
                                     [11-14]      [20-25]      [26-30]
                                     [15-19]
```

Within Phase 3, issues 11-14 are prerequisites for 15-19. Issues 15-19 can be parallelized.
Within Phase 4, issue 20 is a prerequisite for 21-25. Issues 21-25 can be parallelized.
