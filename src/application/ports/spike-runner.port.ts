import type { SpikeAnswer } from '../../domain/types'

export interface SpikeResult {
  readonly answer: SpikeAnswer
  readonly finding: string
  readonly artefactPath?: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SpikeRunnerPort {
  execute(
    spikeId: string,
    code: string,
    options: {
      readonly timeboxSeconds: number
      readonly networkAllowed: boolean
      readonly memoryLimitMb: number
      readonly artefactDir: string
    },
  ): Promise<SpikeResult>
}
