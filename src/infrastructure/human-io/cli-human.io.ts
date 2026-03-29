import type { HumanIOPort, SelectOption } from '../../application/ports'
import { Input } from '@cliffy/prompt'
import { Confirm } from '@cliffy/prompt'
import { Select } from '@cliffy/prompt'

export class CliHumanIO implements HumanIOPort {
  async ask(
    question: string,
    options?: { readonly default?: string },
  ): Promise<string> {
    return Input.prompt({
      message: question,
      default: options?.default,
    })
  }

  async confirm(question: string): Promise<boolean> {
    return Confirm.prompt(question)
  }

  async select<T extends string>(
    question: string,
    options: readonly SelectOption<T>[],
  ): Promise<T> {
    const result = await Select.prompt({
      message: question,
      options: options.map((o) => ({ name: o.label, value: o.value })),
    })
    return result as T
  }
}
