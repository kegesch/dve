import type { Arc42Context, Decision, StackContext } from '../../domain/types'

export type ParsedResult =
  | { readonly type: 'arc42'; readonly data: Arc42Context }
  | { readonly type: 'adr'; readonly data: Decision }
  | { readonly type: 'codebase'; readonly data: StackContext }

export interface ParserPort {
  parse(source: string): Promise<ParsedResult>
}
