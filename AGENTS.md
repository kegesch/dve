# AGENTS.md

## Project

Decision Validation Engine (DVE) — CLI tool that validates architectural decisions before implementation. Repo: `git@github.com:kegesch/dve.git`

## Architecture

Clean architecture. Dependencies point inward only: `CLI → Infrastructure → Application → Domain`. Domain has zero external deps.

## Tech Stack

TypeScript (strict, ESM), Bun, Cliffy (CLI), Vercel AI SDK (agent), Zod (schemas), yaml (eijemerv), dockerode (spikes), eslint, prettier.

## Commands

```bash
bun run build      # bun build --compile (standalone binary)
bun test           # bun:test built-in
bun run lint       # eslint
bun run typecheck  # tsc --noEmit
```

Run all of these after completing work. Fix any failures before committing.

## Key Design Decisions

- **AI as reasoning engine**: Engine orchestrates, AI is a stateless tool-using agent
- **State machine sessions**: Agent drives transitions, engine validates them
- **File-based session storage**: YAML/JSONL in `/decisions/.session/` (gitignored), cleared on commit
- **YAML is source of truth**: In-memory knowledge graph loaded from YAML files
- **Provider-agnostic agent**: Port interface, OpenAI first adapter

## Docs

- Product brief: `docs/decision-validation-engine-brief-v4.md`
- Architecture design: `docs/plans/2026-03-28-dve-architecture-design.md`
- Implementation plan: `docs/plans/2026-03-28-dve-implementation-plan.md`
- GitHub issues #1-30 track all tasks

## Conventions

- No comments in code unless explicitly asked
- Follow existing patterns in the codebase
- Zod schemas define all record types; infer TS types from them (`z.infer`)
- ID format: `DEC-YYYY-NNN`, `ASM-YYYY-NNN`, `SPK-YYYY-NNN`
- All records stored as YAML in `/decisions/` subdirectories
