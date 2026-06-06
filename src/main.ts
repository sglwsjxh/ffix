import { readContext } from './context.js'
import { getFixSuggestion } from './llm.js'
import { install, uninstall } from './shell.js'
import type { FixContext } from './types.js'

const w = (s: string) => process.stderr.write(s)

function keyPress(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once('data', (data) => {
      process.stdin.pause()
      process.stdin.setRawMode(false)
      resolve(data.toString())
    })
  })
}

interface CliArgs {
  subcommand?: 'install' | 'uninstall'
  cmd?: string
  exitCode?: number
  errorOutput?: string
  cwd?: string
  json: boolean
  quiet: boolean
  confirm: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, quiet: false, confirm: false }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case 'install':
        args.subcommand = 'install'
        break
      case 'uninstall':
        args.subcommand = 'uninstall'
        break
      case '--cmd':
        args.cmd = argv[++i]
        break
      case '--exit-code':
        args.exitCode = Number(argv[++i])
        break
      case '--error-output':
        args.errorOutput = argv[++i]
        break
      case '--cwd':
        args.cwd = argv[++i]
        break
      case '--json':
        args.json = true
        break
      case '--quiet':
        args.quiet = true
        break
      case '--confirm':
        args.confirm = true
        break
    }
  }

  return args
}

function buildContextFromArgs(args: CliArgs): FixContext {
  return {
    lastCommand: args.cmd!,
    exitCode: args.exitCode!,
    errorOutput: args.errorOutput ?? '',
    cwd: args.cwd ?? process.cwd(),
    shell: 'powershell-7',
    os: 'win32',
    timestamp: new Date().toISOString(),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.subcommand === 'install') {
    await install()
    return
  }

  if (args.subcommand === 'uninstall') {
    await uninstall()
    return
  }

  let context: FixContext | null = null

  if (args.cmd && args.exitCode !== undefined && !Number.isNaN(args.exitCode)) {
    context = buildContextFromArgs(args)
  } else {
    context = await readContext()
  }

  if (!context) {
    console.error('没有找到上一条命令的上下文')
    process.exit(1)
  }

  const suggestion = await getFixSuggestion(context)

  if (!suggestion || !suggestion.command) {
    console.error('没能找到修复方案')
    process.exit(1)
  }

  if (args.confirm) {
    w(`上一条命令：${context.lastCommand}\n\n`)
    w(`\x1b[32m✦  建议执行：${suggestion.command}\x1b[0m\n\n`)
    w('Enter = 执行    Ctrl+C = 取消')

    try {
      const key = await keyPress()
      if (key === '\r' || key === '\n') {
        process.stderr.write(`\n\n\x1b[32m> ${suggestion.command}\x1b[0m\n`)
        process.stdout.write(suggestion.command)
        process.exit(0)
      }
      process.stderr.write('\n\n已取消\n')
      process.exit(1)
    } catch {
      process.exit(1)
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      command: suggestion.command,
      confidence: suggestion.confidence ?? 'medium',
    }))
  } else if (args.quiet) {
    console.log(suggestion.command)
  } else {
    console.log(suggestion.command)
  }

  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
