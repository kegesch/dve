import type {
  Arc42Context,
  Assumption,
  Decision,
  GapsContext,
  Spike,
  StackContext,
} from '../../domain/types'

export interface GraphStorePort {
  readRecords(): Promise<readonly Decision[]>
  writeRecord(record: Decision): Promise<void>
  readAssumptions(): Promise<readonly Assumption[]>
  writeAssumption(assumption: Assumption): Promise<void>
  readSpikes(): Promise<readonly Spike[]>
  writeSpike(spike: Spike): Promise<void>
  readContext(): Promise<{
    readonly arc42: Arc42Context | null
    readonly stack: StackContext | null
    readonly gaps: GapsContext | null
  }>
  writeContext(
    type: 'arc42' | 'stack' | 'gaps',
    data: Arc42Context | StackContext | GapsContext,
  ): Promise<void>
}
