# Product Brief
## Decision Validation Engine

An AI-powered system for validating architectural and product decisions before implementation begins.
**Version**: 
0.4 — Schema and CLI flow defined
**Status**: 
Ready for prototype
**Primary author**: 
Collaborative — AI-assisted planning session
**Target user**: 
Small engineering teams (2–10 people)
**Domain**: 
Architecture decisions + feature validation


## Problem statement
Small engineering teams make architectural and product decisions under uncertainty, without explicitly surfacing hidden assumptions or validating high-risk intersections upfront. When problems emerge during implementation, sunk cost dynamics prevent early course correction.

The result is wasted weeks, eroded team confidence, and a cycle that repeats — because the decision process itself is never fixed, only the outcome is blamed.


### Example 1 — Technical assumption failure
A team migrated from Keycloak to Spring Authorization Server to gain custom JWT claim injection. An ADR was written — but it recorded the decision, not the assumptions underneath it. The killing question was never asked: 'Does Spring Authorization Server handle non-standard certificate auth combined with an SSO bridge cleanly?' Four weeks of implementation later, after hitting that exact wall, the team rolled back. Cost: 4 weeks, eroded team confidence, dropped trust in technical decision-making.


### Example 2 — Environmental assumption failure
A team built a web application as a sensible default, only to discover mid-build that users authenticate via PKI smart card — a hardware peripheral that has no standard interface in a browser context. The team was forced to pivot to Tauri with client-side Rust code. The invalidating information was available from day one in the system context. It was never connected to the technology decision.


### Example 3 — Domain assumption failure
A team designed a full onboarding flow — user self-registration, access request, admin approval — because they assumed the system had no way to identify users without self-registration. In reality, the DN subject of the PKI card was already known in the PKI infrastructure. The entire feature was built to solve a problem that did not exist. The domain assumption was never questioned because it was embedded silently in the requirement itself.

Current AI-assisted coding tools accelerate execution. None of them address the discovery and validation phase — the part where the most expensive mistakes originate.

**Target user**: 
Small engineering teams of 2–10 people who:

Make architectural or product decisions regularly, often under time pressure
Already use lightweight documentation practices (ADRs, RFCs, or similar)
Have experienced at least one significant pivot or rollback caused by a wrong early assumption
Want AI to do analytical heavy lifting, with humans reviewing and deciding

Out of scope (v1)
Large enterprise orgs with dedicated architecture review boards, solo developers without a team dynamic to address, and non-technical product teams without engineering involvement.


## Core insight
The failure mode is not bad decisions. It is undeclared assumptions treated as facts.

Three stress tests against real failures reveal three distinct classes of assumption that teams systematically fail to surface:

Class
Description

### Example killing question
Technical
Assumptions about libraries, frameworks, or implementations. Usually caught by spikes.
Does Spring AS handle cert auth + SSO bridge cleanly?
Environmental
Assumptions about the physical, organisational, or deployment context users operate in. Fed by arc42 System Context and boundary conditions.
Does the user's auth mechanism require hardware peripherals a browser cannot reach?
**Domain**: 
Assumptions about how the problem space works, embedded silently inside requirements themselves. The hardest to catch — they feel like facts, not assumptions.
Is the user's card identity already known to the system via PKI infrastructure, without self-registration?

The engine must probe all three classes during decomposition. Technical assumptions are surfaced by intersection analysis. Environmental assumptions are surfaced by reading the system context. Domain assumptions are surfaced by questioning the origin of every requirement — asking what constraint the requirement assumes to be true before decomposing how to implement it.


## Core loop
The engine runs a structured validation cycle for every decision brought to it:

1
Ingest the goal
Architecture decision, feature idea, migration plan, or technical spike. Natural language input.
2
Decompose
Separate hard requirements from implicit assumptions and constraints. Identify intersections — where a requirement meets an unvalidated assumption.
3
Stress test
Apply stressors to each intersection. Rank risks by likelihood × impact × spike cost. Generate a killing question per assumption.
4
Generate spikes
For high-risk assumptions: define a minimal, isolated, time-boxed prototype. Human reviews scope. Engine runs it. Output is a yes/no decision, not code.
5
Commit gate
Team explicitly signs off on the validated plan. Not passive consensus — an active forcing function. Open assumptions are named and either resolved or accepted as conscious bets.
6
Output
A validated plan with resolved assumptions, a living ADR, and an implementation-ready brief. Documentation is the byproduct of validation, not the goal.


## Context model
The engine learns about a team's system through three layers:

Persistent context — read once, always available. Tech stack, team size, existing architecture, past ADRs. Ingested from the codebase and existing docs, not manually typed.
Decision context — asked per session. Goal, timeline pressure, constraints specific to this decision. Lightweight, targeted, not a form.
Discovered context — emerges from spikes. Things the engine could not have known until it ran a prototype. Feeds back into persistent context so future decisions benefit.


## Spike lifecycle
Spikes are the engine's primary validation mechanism. They are not prototypes for the product. They are throwaway experiments whose only output is a decision.

A well-formed spike has four properties:

Scoped to exactly one killing question
Isolated from the product codebase
Time-boxed (target: 1–2 days maximum)
Output is binary: the assumption holds, or it does not

The engine defines the spike. The human reviews and approves the scope. The engine then runs it autonomously and returns a result that feeds back into the risk ranking and plan.


## Theoretical grounding
The engine is grounded in Residuality Theory (Barry O'Reilly). The core principle: do not design for what you know. Design for what survives stress.

In practice this means: identify what remains of your system after stressors are applied — the residues — and build around those. Applied to decision validation, a stressor is any real constraint or failure condition that challenges an assumption. The residue is what still holds after the stressor is applied.

In the Spring Authorization Server example: the stressors were non-standard certificate auth and SSO bridge compatibility. The residue — what survived — was Keycloak without custom claims. That residue was discovered after 4 weeks. The engine is designed to find it before a line of code is written.


## Scope
In scope — v1
Architecture decisions: library choices, migration plans, infrastructure changes, integration approaches
Feature validation: user-facing feature ideas with hidden assumptions about user behaviour, data models, or technical feasibility
Both domain types share the same core engine with domain-aware stressor sets

Explicitly not in scope — v1
Sprint planning or task management
Code review or pull request analysis
Post-mortem or retrospective tooling
Real-time pair programming assistance
Replacing human judgment — the engine informs and forces structure; humans decide


## What this is not

Not a documentation tool
Documentation (ADRs, RFCs) is the output of the process, not the product. The product is the validation loop that produces better documentation as a byproduct.

Not another AI coding assistant
Existing tools (Cursor, Copilot, Claude Code) accelerate execution. This engine operates before execution begins. It is orthogonal to those tools, not competitive.

Not a planning tool with AI bolted on
The AI does the analytical heavy lifting — decomposition, intersection analysis, spike scoping, execution. The human reviews and decides. The AI is not a search assistant for planning documents.


## Resolved design questions
The following questions were open in v0.1 and have now been resolved through structured discovery.

1. How are discoveries stored and connected?
A three-layer knowledge graph, stored as structured files in the repository and versioned with git:

Layer 1 — Decision records: goal, options considered, decision made, open bets at commit time
Layer 2 — Validated and invalidated assumptions: the reusable atoms of institutional memory. An invalidated assumption about OAuth2 is relevant to any future auth decision, regardless of which library is being evaluated. This is the moat.
Layer 3 — Implication chains: how a learning in one decision constrains future decisions. The engine reasons about relevance, not just retrieval.

Why Layer 2 is the moat
Decision records are structured ADRs — any tool can store those. A growing, connected map of validated and invalidated assumptions, tagged by domain and implication, that surfaces automatically at decision time — that is what creates compounding value the longer a team uses the engine.

2. How does it tell you to stop?
There are two distinct stop signals, firing at different points in the loop:

Stop signal type 1 — Solution contradiction
Fires during stress testing. The engine queries Layer 2 for invalidated assumptions that undermine the proposed solution. Example: 'Based on a prior learning from your team, OAuth2 is not suitable for trusted client scenarios. Before evaluating implementations, this needs to be re-examined at the architectural level.' The signal has provenance — a specific prior learning, a date, a spike result. That is what makes it credible rather than dismissable.

Stop signal type 2 — Requirement invalidation
Fires during decomposition, before stress testing begins. The engine probes the origin of every requirement: what domain assumption does this requirement depend on? If that assumption can be cheaply invalidated, the requirement itself may not exist. Example: 'This onboarding flow assumes the system cannot identify users without self-registration. PKI infrastructure exposes the DN subject — is self-registration actually necessary?' Type 2 is more valuable than type 1. It saves not just implementation time but design, scoping, and team discussion time for a feature that should never have been built.

3. How does the commit gate work?
Before the team meeting, the engine produces a commit brief — not a summary of the decision, but a structured exposure of what the team is actually agreeing to:

Validated assumptions — what the spikes confirmed
Conscious bets — assumptions still open, ranked by risk, explicitly named
The residue — what survives if the riskiest bet turns out wrong
A sign-off question per person: 'Are you aware of and willing to accept these open bets?'

This changes the social dynamic. Instead of 'does anyone object?' — which puts the burden on the dissenter — each person must explicitly acknowledge the uncertainty. Silence is no longer consent. Fuzzy concerns get language: 'I'm not comfortable signing off on bet #2.'

Every signed conscious bet becomes a tracked assumption in Layer 2. When reality later confirms or invalidates it, that becomes a learning — automatically connected to the decision that made the bet.

4. Where does it live?
The engine lives in the repository. Decisions are versioned with the code they produce.

The interface is a CLI tool that runs locally and reads from and writes to a structured /decisions directory in the repo. The knowledge graph is stored as structured YAML or JSON files — portable, diffable, git-native. An optional local web UI can be spun up for richer commit gate sessions.

Why not a SaaS platform or IDE plugin?
Decisions are too consequential and too conversational for an IDE plugin. A SaaS platform creates an external dependency and disconnects decisions from the code they affect. The repo-native model means the knowledge graph travels with the codebase, new team members get full institutional memory on clone, and there is no vendor lock-in on your team's most valuable asset.

5. Minimum viable context for onboarding?
Running 'dve init' in any repository is sufficient to begin. The engine reads four sources in priority order, and asks only for what is missing:

arc42 documentation (if present) — System Context and boundary conditions (chapters 2 and 3). The richest source of user environment, physical constraints, and deployment reality. This is where environmental assumptions live.
Existing ADRs — prior decisions and their rationale
Codebase structure — tech stack, dependencies, build config, inferred from existing files
Prior decision records in /decisions — if the engine has been used before

Only what is missing after reading all four sources gets asked in a lightweight interview. The engine does not ask you to re-enter what you have already documented.

arc42 as a first-class input
arc42 is a well-structured template that most teams fill in partially and never update. The engine gives arc42 documentation a functional purpose: it actively shapes every decision the engine evaluates. When a decision produces a learning that contradicts or extends the system context, the engine suggests an update to the arc42 doc. Documentation stays alive because it has a job to do.


## Data schema
The knowledge graph is stored as three YAML record types in /decisions, versioned with git. All connections are explicit references — no relational database required.

Directory structure
/decisions structure
/decisions
  /records          <- Layer 1: DEC-YYYY-NNN.yaml
  /assumptions       <- Layer 2: ASM-YYYY-NNN.yaml
  /spikes            <- SPK-YYYY-NNN.yaml
    /artefacts       <- throwaway spike code and notes
  /context           <- arc42.yaml  stack.yaml  gaps.yaml

Layer 2 — Assumption record (ASM)
The core atom of the knowledge graph. Class, status, evidence, implication that fires as a stop signal, and links to related assumptions that form implication chains.

id — ASM-YYYY-NNN, minted by the engine at session commit
class — technical | environmental | domain
statement — the assumption as a plain sentence
origin.decision — the DEC record this assumption was first identified in
status — unvalidated | validated | invalidated | accepted-bet
evidence.source — spike | production | review | interview
evidence.finding — what was actually discovered
implication.summary — what this means for future decisions if invalidated
implication.signal_type — type-1 (fires against solutions) | type-2 (fires against requirements)
tags — controlled vocabulary per domain — the retrieval mechanism
related_assumptions — links to other ASM records, forming Layer 3 implication chains

Layer 1 — Decision record (DEC)
The container. References assumption records rather than duplicating them. Includes residue as a first-class field from Residuality Theory — what survives if the riskiest bet fails.

id — DEC-YYYY-NNN
type — architecture | feature | migration | spike
status — active | superseded | rolled-back | validated
goal — the original stated goal, verbatim
assumptions.validated / invalidated / accepted_bets — lists of ASM IDs
residue — what remains if the riskiest bet fails — forces explicit fallback thinking
outcome — result + cost_weeks + superseded_by — filled in retrospectively
commit_signatories — who signed off and when — empty for pre-DVE legacy decisions
arc42_sections_affected — triggers dve arc42 suggest after commit
code_refs — paths in the repo most directly affected

Spike record (SPK)
The bridge between an assumption and its evidence. Supports discovery chains — a spike can reveal new assumptions and spawn child spikes, each requiring human approval before running.

validates_assumption — the ASM ID this spike was designed to answer
parent_spike — null for root spikes, SPK ID if spawned by a prior finding
killing_question — the single binary question this spike must answer
scope — timebox_days (hard cap) + isolated: true + approved_by (human reviewer)
result.answer — yes | no | inconclusive — intentionally blunt
result.finding — the raw evidence behind the answer
executed_by — engine | human | paired
reveals_assumptions — new ASM records discovered during the spike
triggers_spikes — child spikes proposed, each requiring human approval before running
artefact_path — throwaway code preserved in /decisions/spikes/artefacts/


## CLI session flow
Four commands map to four distinct moments in the decision lifecycle. The session is conversational — the engine asks, the human responds, records are written at commit time.

dve init
Run once per repository. Builds persistent context from existing documentation without asking for information already written down.

Reads arc42 System Context (chapter 3) and boundary conditions (chapter 2) first
Reads existing ADRs and imports them as legacy DEC records — marked without commit gate
Infers tech stack from package files, build config, and directory structure
Identifies gaps and asks only for those — typically 2 to 5 targeted questions
Writes context to decisions/context/ as arc42.yaml, stack.yaml, and gaps.yaml

Legacy decisions get imported honestly
Pre-DVE ADRs are imported with commit_signatories: [] and all assumptions marked unvalidated. The engine flags these as higher-risk when they surface in future decisions. This is information, not a failure.

dve new
Starts a decision session. Takes a natural language goal and runs the full decomposition and stress-testing loop before proposing spikes.

Immediately queries the knowledge graph for stop signals — invalidated assumptions and unvalidated bets in the same domain
Asks one targeted scoping question if needed — not a form
Decomposes the goal into hard requirements, implicit assumptions across all three classes, and arc42 constraints
Runs intersection analysis — where a requirement meets an unvalidated assumption under a constraint
Probes the origin of every requirement for domain assumptions — what must be true for this requirement to exist
Produces a risk-ranked assumption list with killing questions and a proposed spike plan

dve spike review
Human gate before any spike executes. Each proposed spike can be approved, modified, dropped, or deferred.

Approve — spike runs as proposed
Modify — adjust timebox, assignee, or scope before approving
Drop — assumption accepted as a conscious bet, no spike needed
Defer — spike runs after commit, logged as a pending bet

When a spike completes and reveals new assumptions, the engine proposes adding them and optionally spawning a child spike — human approves each before the child runs. Spikes are marked executed_by: human when the engine cannot run them autonomously — compliance reviews, hardware tests, interviews.

dve commit
The commit gate. Produces a structured brief of what the team is agreeing to, then collects an explicit named sign-off from each team member.

Lists validated assumptions with spike evidence
Lists conscious bets ranked by risk
States the residue — what survives if the riskiest bet fails
Collects a named sign-off from each team member with optional notes recorded alongside

After sign-off the engine writes all records to /decisions, suggests arc42 sections that may need updating, and outputs the git command to commit the decision graph alongside the code changes.

The social dynamic shift
Instead of 'does anyone object?' — which puts the burden on the dissenter — dve commit asks each person to explicitly acknowledge the uncertainty. Silence is no longer consent. Every signed bet becomes a tracked assumption in Layer 2, closed when reality confirms or invalidates it.


## Next steps
Build a working prototype of dve init and dve new — validate decomposition and intersection analysis against the three stress-test examples
Implement the knowledge graph query — reading Layer 2 to surface stop signals at session start
Define the controlled tag vocabulary per domain — authentication, data, infrastructure, compliance, UX
Design the arc42 ingestion parser — which sections map to which assumption classes, how gaps are detected
Define the spike execution sandbox — the environment the engine uses to run autonomous spikes safely and in isolation
Decide on local web UI for dve commit: required for v1 sign-off sessions, or post-launch addition?

— end of brief —