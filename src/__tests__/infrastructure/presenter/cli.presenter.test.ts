import { describe, test, expect, mock } from 'bun:test'
import { CliPresenter } from '../../../infrastructure/presenter/cli.presenter'

describe('CliPresenter', () => {
  test('display calls console.log', () => {
    const log = mock(() => {})
    const origLog = console.log
    console.log = log

    const presenter = new CliPresenter()
    presenter.display('Hello')

    console.log = origLog
    expect(log).toHaveBeenCalledWith('Hello')
  })

  test('displayError calls console.error with ANSI red', () => {
    const error = mock(() => {})
    const origError = console.error
    console.error = error

    const presenter = new CliPresenter()
    presenter.displayError('Something went wrong')

    console.error = origError
    expect(error).toHaveBeenCalled()
    const msg = (error.mock.calls as string[][])[0][0]
    expect(msg).toContain('Something went wrong')
    expect(msg).toContain('\x1b[31m')
  })

  test('displayProgress outputs state with ANSI cyan', () => {
    const log = mock(() => {})
    const origLog = console.log
    console.log = log

    const presenter = new CliPresenter()
    presenter.displayProgress('SCOPING')

    console.log = origLog
    expect(log).toHaveBeenCalled()
    const msg = (log.mock.calls as string[][])[0][0] as string
    expect(msg).toContain('Scoping')
    expect(msg).toContain('\x1b[36m')
  })

  test('displayProgress includes metadata when provided', () => {
    const log = mock(() => {})
    const origLog = console.log
    console.log = log

    const presenter = new CliPresenter()
    presenter.displayProgress('DECOMPOSING', { step: 2 })

    console.log = origLog
    const msg = (log.mock.calls as string[][])[0][0] as string
    expect(msg).toContain('step')
  })
})
