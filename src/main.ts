#!/usr/bin/env node

import { readContext, readContextFromPath } from './context.js'
import { getFixSuggestion } from './llm.js'
import { install, uninstall } from './shell.js'
import { ensureConfig } from './config.js'
import type { FixContext } from './types.js'

const w = (s: string) => process.stderr.write(s)

export function keyPress(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    process.stderr.write('当前终端不是交互式终端，无法确认执行\n')
    return Promise.resolve('')
  }

  return new Promise((resolve, reject) => {
    try {
      process.stdin.setRawMode(true)
      process.stdin.resume()

      process.stdin.once('data', (data) => {
        try {
          process.stdin.setRawMode(false)
          process.stdin.pause()
        } catch (err) {
          // Best effort cleanup: stdin stream may already be closed
        }

        const key = data.toString()
        if (key === '\x03') {
          process.stderr.write('\n已取消\n')
          process.exit(130)
          return
        }

        resolve(key)
      })
    } catch (err) {
      try {
        process.stdin.setRawMode(false)
        process.stdin.pause()
      } catch (err2) {
        // Best effort cleanup: stdin stream may already be closed
      }
      reject(err)
    }
  })
}

interface CliArgs {
  subcommand?: 'install' | 'uninstall'
  cmd?: string
  exitCode?: number
  errorOutput?: string
  cwd?: string
  contextFile?: string
  json: boolean
  confirm: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, confirm: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === 'install') {
      args.subcommand = 'install'
      continue
    }

    if (arg === 'uninstall') {
      args.subcommand = 'uninstall'
      continue
    }

    if (arg.startsWith('--')) {
      if (arg === '--cmd') {
        const val = argv[++i]
        if (val === undefined || val === '') {
          console.error('error: --cmd requires a non-empty value')
          throw new Error('parse error')
        }
        args.cmd = val
        continue
      }

      if (arg === '--context-file') {
        const val = argv[++i]
        if (val === undefined || val === '') {
          console.error('error: --context-file requires a non-empty value')
          throw new Error('parse error')
        }
        args.contextFile = val
        continue
      }

      if (arg === '--exit-code') {
        const val = argv[++i]
        if (val === undefined) {
          console.error('error: --exit-code requires a numeric value')
          throw new Error('parse error')
        }
        const num = Number(val)
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          console.error(`error: --exit-code must be a finite integer, got "${val}"`)
          throw new Error('parse error')
        }
        args.exitCode = num
        continue
      }

      if (arg === '--error-output') {
        const val = argv[++i]
        if (val === undefined) {
          console.error('error: --error-output requires a value')
          throw new Error('parse error')
        }
        args.errorOutput = val
        continue
      }

      if (arg === '--cwd') {
        const val = argv[++i]
        if (val === undefined) {
          console.error('error: --cwd requires a value')
          throw new Error('parse error')
        }
        args.cwd = val
        continue
      }

      if (arg === '--json') {
        args.json = true
        continue
      }

      if (arg === '--confirm') {
        args.confirm = true
        continue
      }

      console.error(`error: unknown flag ${arg}`)
      throw new Error('parse error')
    }

    console.error(`error: unknown argument "${arg}"`)
    throw new Error('parse error')
  }

  const hasLegacyContextArgs = args.cmd !== undefined || args.exitCode !== undefined || args.errorOutput !== undefined || args.cwd !== undefined

  if (args.contextFile !== undefined && hasLegacyContextArgs) {
    console.error('error: cannot combine --context-file with legacy context arguments (--cmd, --exit-code, --error-output, --cwd)')
    throw new Error('parse error')
  }

  if (args.subcommand && (hasLegacyContextArgs || args.contextFile !== undefined)) {
    console.error('error: cannot combine install/uninstall with fix arguments (--context-file, --cmd, --exit-code, --error-output, --cwd)')
    throw new Error('parse error')
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

export async function main(): Promise<number> {
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (parseErr) {
    return 1
  }

  if (args.subcommand === 'install') {
    await install()
    return 0
  }

  if (args.subcommand === 'uninstall') {
    await uninstall()
    return 0
  }

  const configStatus = await ensureConfig()
  if (configStatus === 'created') {
    console.log('请编辑 config/config.json 配置文件后重新运行')
    return 0
  }

  let context: FixContext | null = null

  if (args.contextFile !== undefined) {
    context = await readContextFromPath(args.contextFile)
  } else if (args.cmd && args.exitCode !== undefined && !Number.isNaN(args.exitCode)) {
    context = buildContextFromArgs(args)
  } else {
    context = await readContext()
  }

  if (!context) {
    console.error('没有找到上一条命令的上下文')
    return 1
  }

  w(`上一条命令：${context.lastCommand}\n`)
  const suggestion = await getFixSuggestion(context)

  if (!suggestion || !suggestion.command) {
    console.error('没能找到修复方案')
    return 1
  }

  if (args.confirm) {
    w(`\x1b[32m✦  建议执行：${suggestion.command}\x1b[0m\n\n`)
    w('Enter = 执行    Ctrl+C = 取消')

    try {
      const key = await keyPress()
      if (key === '\r' || key === '\n') {
        process.stderr.write(`\n\n\x1b[32m> ${suggestion.command}\x1b[0m\n`)
        process.stdout.write(suggestion.command)
        return 0
      }
      process.stderr.write('\n\n已取消\n')
      return 1
    } catch (confirmErr) {
      return 1
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      command: suggestion.command,
      confidence: suggestion.confidence ?? 'medium',
    }))
  } else {
    console.log(suggestion.command)
  }

  return 0
}

if (!process.env.VITEST) {
  main().then((code) => process.exit(code)).catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
