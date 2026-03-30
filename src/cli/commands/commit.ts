import type { AppContainer } from '../container'
import type { Assumption, Decision, Spike } from '../../domain/types'
import {
  buildCommitGateContext,
  generateCommitBrief,
} from '../../application/engine/commit-gate'
import { mintDecisionId } from '../../domain/id/id-minter'
import { DecisionSchema } from '../../domain/validation/schemas'

export interface CommitResult {
  committed: boolean
  decisionId: string
  recordsWritten: number
  signatoriesCount: number
  sessionCleared: boolean
}

export async function runCommit(
  container: AppContainer,
): Promise<CommitResult> {
  const { presenter, humanIO, sessionStore, sessionService, graphStore } =
    container

  const sessionState = await sessionStore.loadState()

  if (!sessionState) {
    presenter.displayError('No active session to commit.')
    return {
      committed: false,
      decisionId: '',
      recordsWritten: 0,
      signatoriesCount: 0,
      sessionCleared: false,
    }
  }

  if (sessionState.state !== 'COMMIT') {
    presenter.displayError(
      `Session is in state "${sessionState.state}", not "COMMIT". Complete the pipeline first.`,
    )
    return {
      committed: false,
      decisionId: '',
      recordsWritten: 0,
      signatoriesCount: 0,
      sessionCleared: false,
    }
  }

  const graph = await sessionService.loadGraph()
  const drafts = await sessionStore.loadDrafts()

  const context = buildCommitGateContext(sessionState, graph, {
    assumptions: drafts.assumptions,
    spikes: drafts.spikes,
  })

  const brief = generateCommitBrief(context)

  presenter.display('\n=== Commit Brief ===\n')
  presenter.display(`Decision: ${brief.summary}`)
  presenter.display(`Validated assumptions: ${brief.validatedCount}`)
  presenter.display(`Invalidated assumptions: ${brief.invalidatedCount}`)
  presenter.display(`Accepted bets: ${brief.acceptedBetCount}`)

  if (brief.spikeResults.length > 0) {
    presenter.display('\nSpike Results:')
    for (const sr of brief.spikeResults) {
      presenter.display(`  ${sr.spikeId}: ${sr.answer} - ${sr.finding}`)
    }
  }

  if (brief.residue) {
    presenter.display(`\nResidue: ${brief.residue}`)
  }

  if (context.acceptedBets.length > 0) {
    presenter.display('\nAccepted Bets (ranked by risk):')
    const ranked = rankBetsByRisk(context.acceptedBets)
    for (const bet of ranked) {
      presenter.display(`  - ${bet.id}: ${bet.statement}`)
    }
  }

  const signatories: Array<{ name: string; signed_at: string }> = []

  presenter.display('\n--- Sign-off ---')
  const addMore = true
  while (addMore) {
    const name = await humanIO.ask('Signatory name (or press Enter to finish):')
    if (!name.trim()) break

    const aware = await humanIO.confirm(
      `Are you aware of and willing to accept these open bets, ${name}?`,
    )
    if (!aware) {
      presenter.display(`${name} declined to sign. Stopping commit.`)
      return {
        committed: false,
        decisionId: '',
        recordsWritten: 0,
        signatoriesCount: signatories.length,
        sessionCleared: false,
      }
    }

    const notes = await humanIO.ask('Optional notes (or press Enter to skip):')

    signatories.push({
      name: name.trim(),
      signed_at: new Date().toISOString(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    })

    const more = await humanIO.confirm('Add another signatory?')
    if (!more) break
  }

  if (signatories.length === 0) {
    presenter.displayError('At least one signatory is required to commit.')
    return {
      committed: false,
      decisionId: '',
      recordsWritten: 0,
      signatoriesCount: 0,
      sessionCleared: false,
    }
  }

  const existingRecords = await graphStore.readRecords()
  const existingIds = existingRecords.map((r) => r.id)
  const year = new Date().getFullYear().toString()
  const decisionId = mintDecisionId(year, existingIds)

  const validatedIds = context.validatedAssumptions.map((a) => a.id)
  const invalidatedIds = context.invalidatedAssumptions.map((a) => a.id)
  const acceptedBetIds = context.acceptedBets.map((a) => a.id)

  const arc42SectionsAffected = suggestArc42Sections(
    context.validatedAssumptions,
    context.acceptedBets,
    context.spikes,
  )

  const decision: Decision = DecisionSchema.parse({
    id: decisionId,
    type: context.decision.type,
    status: 'validated',
    goal: context.decision.goal,
    assumptions: {
      validated: validatedIds,
      invalidated: invalidatedIds,
      accepted_bets: acceptedBetIds,
    },
    residue:
      context.decision.residue ||
      `Survives if riskiest bet fails: continue with validated assumptions only.`,
    commit_signatories: signatories,
    arc42_sections_affected: arc42SectionsAffected,
    code_refs: [],
  })

  await graphStore.writeRecord(decision)

  let recordsWritten = 1

  for (const assumption of drafts.assumptions) {
    await graphStore.writeAssumption(assumption)
    recordsWritten++
  }

  for (const spike of drafts.spikes) {
    await graphStore.writeSpike(spike)
    recordsWritten++
  }

  await sessionStore.clear()

  presenter.display('\n=== Commit Successful ===')
  presenter.display(`Decision: ${decisionId}`)
  presenter.display(`Records written: ${recordsWritten}`)
  presenter.display(`Signatories: ${signatories.map((s) => s.name).join(', ')}`)

  if (arc42SectionsAffected.length > 0) {
    presenter.display(
      `\nConsider updating these arc42 sections: ${arc42SectionsAffected.join(', ')}`,
    )
  }

  presenter.display(
    `\nTo commit alongside code changes, run:\n  git add decisions/ && git commit -m "decision: ${decisionId}"`,
  )

  return {
    committed: true,
    decisionId,
    recordsWritten,
    signatoriesCount: signatories.length,
    sessionCleared: true,
  }
}

function rankBetsByRisk(bets: readonly Assumption[]): Assumption[] {
  return [...bets].sort((a, b) => {
    const scoreA = getRiskScore(a)
    const scoreB = getRiskScore(b)
    return scoreB - scoreA
  })
}

function getRiskScore(assumption: Assumption): number {
  let score = 0
  if (assumption.related_assumptions.length > 0) score += 2
  if (assumption.class === 'technical') score += 1
  if (assumption.implication) score += 2
  return score
}

function suggestArc42Sections(
  validated: readonly Assumption[],
  bets: readonly Assumption[],
  spikes: readonly Spike[],
): string[] {
  const sections = new Set<string>()

  for (const a of [...validated, ...bets]) {
    if (a.class === 'technical') sections.add('Solution Strategy')
    if (a.class === 'environmental') sections.add('Architecture Constraints')
    if (a.class === 'domain') sections.add('System Scope and Context')
    if (a.tags.some((t) => t.includes('deploy') || t.includes('infra')))
      sections.add('Deployment View')
    if (a.tags.some((t) => t.includes('quality') || t.includes('perf')))
      sections.add('Quality Requirements')
  }

  for (const s of spikes) {
    if (s.artefact_path) sections.add('Building Block View')
  }

  return [...sections]
}
