import { loadConfig } from './config'
import { createContainer } from './container'
import { runInit } from './commands/init'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    console.log('dve — Decision Validation Engine')
    console.log()
    console.log('Commands:')
    console.log(
      '  init    Build persistent context from docs, ADRs, and codebase',
    )
    console.log('  --help  Show this help message')
    console.log()
    console.log('Options:')
    console.log('  --decisions-dir <dir>  Override decisions directory')
    console.log('  --provider <provider>  AI provider (openai|anthropic)')
    console.log('  --model <model>        AI model name')
    process.exit(0)
  }

  const cliOptions: Record<string, string> = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i]?.startsWith('--') && args[i + 1]) {
      const key = args[i]!.slice(2).replace(/-([a-z])/g, (_, c: string) =>
        c.toUpperCase(),
      )
      cliOptions[key] = args[i + 1]
      i++
    }
  }

  if (command === 'init') {
    const config = loadConfig({
      provider: cliOptions['provider'],
      model: cliOptions['model'],
      decisionsDir: cliOptions['decisionsDir'],
    })
    const container = createContainer(config)
    await runInit(container, process.cwd())
    return
  }

  console.error(`Unknown command: ${command}`)
  console.error('Run "dve --help" for usage information')
  process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
