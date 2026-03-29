import type { SessionState } from '../../domain/types'

export interface PresenterPort {
  display(message: string): void
  displayError(error: string): void
  displayTable(
    headers: readonly string[],
    rows: ReadonlyArray<readonly string[]>,
  ): void
  displayProgress(state: SessionState, metadata?: Record<string, unknown>): void
}
