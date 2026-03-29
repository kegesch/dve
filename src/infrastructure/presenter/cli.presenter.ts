import type { SessionState } from '../../domain/types'
import type { PresenterPort } from '../../application/ports'
import { Table } from '@cliffy/table'

const STATE_LABELS: Record<SessionState, string> = {
  SCOPING: '🔍 Scoping',
  DECOMPOSING: '🔬 Decomposing',
  STRESS_TESTING: '⚡ Stress Testing',
  SPIKE_PLANNING: '📋 Spike Planning',
  SPIKE_REVIEW: '👀 Spike Review',
  SPIKE_EXECUTING: '🧪 Spike Executing',
  COMMIT: '✅ Commit',
}

export class CliPresenter implements PresenterPort {
  display(message: string): void {
    console.log(message)
  }

  displayError(error: string): void {
    console.error(`\x1b[31mError: ${error}\x1b[0m`)
  }

  displayTable(
    headers: readonly string[],
    rows: ReadonlyArray<readonly string[]>,
  ): void {
    new Table()
      .header([...headers])
      .body(rows.map((r) => [...r]))
      .border(true)
      .render()
  }

  displayProgress(
    state: SessionState,
    metadata?: Record<string, unknown>,
  ): void {
    const label = STATE_LABELS[state] ?? state
    const meta = metadata ? ` ${JSON.stringify(metadata)}` : ''
    console.log(`\n\x1b[36m── ${label}${meta} ──\x1b[0m\n`)
  }
}
