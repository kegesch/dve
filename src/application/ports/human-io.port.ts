export interface SelectOption<T extends string = string> {
  readonly value: T
  readonly label: string
}

export interface HumanIOPort {
  ask(
    question: string,
    options?: { readonly default?: string },
  ): Promise<string>
  confirm(question: string): Promise<boolean>
  select<T extends string>(
    question: string,
    options: readonly SelectOption<T>[],
  ): Promise<T>
}
