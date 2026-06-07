import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

let keyPress: () => Promise<string>
type CliArgs = {
  subcommand?: 'install' | 'uninstall'
  cmd?: string
  exitCode?: number
  errorOutput?: string
  cwd?: string
  contextFile?: string
  json: boolean
  confirm: boolean
}

beforeAll(async () => {
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const mod = await import('../main.js')
  keyPress = mod.keyPress
})

beforeEach(() => {
  vi.mocked(process.exit).mockClear()
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('keyPress()', () => {
  it('resolves with empty string when stdin is not a TTY', async () => {
    const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const origSetRawMode = process.stdin.setRawMode

    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: undefined, configurable: true })

      const result = await keyPress()
      expect(result).toBe('')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: origSetRawMode, configurable: true })
    }
  })

  it('resolves with key data when Enter is pressed in TTY mode', async () => {
    const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const origSetRawMode = process.stdin.setRawMode
    const origResume = process.stdin.resume
    const origPause = process.stdin.pause
    const origOnce = process.stdin.once

    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: vi.fn(), configurable: true })
      process.stdin.resume = vi.fn()
      process.stdin.pause = vi.fn()
      process.stdin.once = vi.fn((_event: string, handler: Function) => {
        setTimeout(() => handler(Buffer.from('\r')), 10)
        return process.stdin
      })

      const result = await keyPress()
      expect(result).toBe('\r')
      expect(process.stdin.setRawMode).toHaveBeenCalledWith(true)
      expect(process.stdin.setRawMode).toHaveBeenCalledWith(false)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: origSetRawMode, configurable: true })
      process.stdin.resume = origResume
      process.stdin.pause = origPause
      process.stdin.once = origOnce
    }
  })

  it('calls process.exit(130) and writes cancel message on Ctrl+C', async () => {
    const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const origSetRawMode = process.stdin.setRawMode
    const origResume = process.stdin.resume
    const origPause = process.stdin.pause
    const origOnce = process.stdin.once
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: vi.fn(), configurable: true })
      process.stdin.resume = vi.fn()
      process.stdin.pause = vi.fn()
      process.stdin.once = vi.fn((_event: string, handler: Function) => {
        setTimeout(() => handler(Buffer.from('\x03')), 10)
        return process.stdin
      })

      void keyPress()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(process.exit).toHaveBeenCalledWith(130)
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('已取消'))
    } finally {
      stderrSpy.mockRestore()
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: origSetRawMode, configurable: true })
      process.stdin.resume = origResume
      process.stdin.pause = origPause
      process.stdin.once = origOnce
    }
  })

  it('rejects when setRawMode throws', async () => {
    const origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const origSetRawMode = process.stdin.setRawMode

    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: vi.fn(() => { throw new Error('raw mode failed') }), configurable: true })

      await expect(keyPress()).rejects.toThrow('raw mode failed')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      Object.defineProperty(process.stdin, 'setRawMode', { value: origSetRawMode, configurable: true })
    }
  })
})

describe('parseArgs()', () => {
  it('returns defaults for empty args', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs([])
    expect(result).toEqual({ json: false, confirm: false, version: false })
  })

  it('parses --version', async () => {
    const { parseArgs } = await import('../main.js')
    expect(parseArgs(['--version'])).toMatchObject({ version: true })
    expect(parseArgs(['-v'])).toMatchObject({ version: true })
  })

  it('parses install subcommand', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['install'])
    expect(result.subcommand).toBe('install')
  })

  it('parses uninstall subcommand', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['uninstall'])
    expect(result.subcommand).toBe('uninstall')
  })

  it('parses full flag combination', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['--cmd', 'git branch', '--exit-code', '1', '--error-output', 'error msg', '--cwd', '/tmp', '--json', '--confirm'])
    expect(result).toEqual({
      cmd: 'git branch',
      exitCode: 1,
      errorOutput: 'error msg',
      cwd: '/tmp',
      json: true,
      confirm: true,
      version: false,
    })
  })

  it('parses flags without optional error-output and cwd', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['--cmd', 'npm test', '--exit-code', '0', '--json'])
    expect(result).toEqual({
      cmd: 'npm test',
      exitCode: 0,
      json: true,
      confirm: false,
      version: false,
    })
  })

  it('parses --context-file', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['--context-file', '/tmp/fuck_ctx.json', '--json'])
    expect(result).toEqual({
      contextFile: '/tmp/fuck_ctx.json',
      json: true,
      confirm: false,
      version: false,
    })
  })

  it('rejects unknown flag', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--unknown'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown flag'))
    consoleSpy.mockRestore()
  })

  it('rejects unknown positional argument', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['nope'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('nope'))
    consoleSpy.mockRestore()
  })

  it('rejects missing value after --cmd', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--cmd'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--cmd'))
    consoleSpy.mockRestore()
  })

  it('rejects missing value after --context-file', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--context-file'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--context-file'))
    consoleSpy.mockRestore()
  })

  it('rejects empty string for --context-file', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--context-file', ''])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--context-file'))
    consoleSpy.mockRestore()
  })

  it('rejects empty string for --cmd', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--cmd', ''])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--cmd'))
    consoleSpy.mockRestore()
  })

  it('rejects missing value after --exit-code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--exit-code'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--exit-code'))
    consoleSpy.mockRestore()
  })

  it('rejects non-numeric --exit-code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--exit-code', 'abc'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('finite integer'))
    consoleSpy.mockRestore()
  })

  it('rejects non-integer --exit-code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--exit-code', '3.14'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('finite integer'))
    consoleSpy.mockRestore()
  })

  it('rejects NaN --exit-code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--exit-code', 'NaN'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('finite integer'))
    consoleSpy.mockRestore()
  })

  it('rejects Infinity --exit-code', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--exit-code', 'Infinity'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('finite integer'))
    consoleSpy.mockRestore()
  })

  it('rejects missing value after --error-output', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--error-output'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--error-output'))
    consoleSpy.mockRestore()
  })

  it('rejects missing value after --cwd', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--cwd'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--cwd'))
    consoleSpy.mockRestore()
  })

  it('accepts exit-code 0 (falsy but valid)', async () => {
    const { parseArgs } = await import('../main.js')
    const result = parseArgs(['--cmd', 'echo', '--exit-code', '0'])
    expect(result.exitCode).toBe(0)
  })

  it('rejects --context-file mixed with legacy context args', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parseArgs } = await import('../main.js')
    expect(() => parseArgs(['--context-file', '/tmp/fuck_ctx.json', '--cmd', 'git brnch'])).toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cannot combine --context-file'))
    consoleSpy.mockRestore()
  })
})

describe('main()', () => {
  it('creates missing config and returns 0 before reading context or calling LLM', async () => {
    const origArgv = process.argv
    const readFile = vi.fn().mockRejectedValue({ code: 'ENOENT' })
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const readContext = vi.fn().mockResolvedValue(null)
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'echo nope', confidence: 'high' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('node:fs/promises', () => ({ readFile, writeFile, mkdir }))
      vi.doMock('../context.js', () => ({ readContext }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      process.argv = ['node', 'ffix']

      const mod = await import('../main.js')
      const exitCode = await mod.main()

      expect(exitCode).toBe(0)
      expect(readFile).toHaveBeenCalled()
      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      expect(writeFile).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('请编辑 ~/.ffix/config.json 配置文件后重新运行'))
      expect(readContext).not.toHaveBeenCalled()
      expect(getFixSuggestion).not.toHaveBeenCalled()
    } finally {
      process.argv = origArgv
      consoleSpy.mockRestore()
      vi.doUnmock('node:fs/promises')
      vi.doUnmock('../context.js')
      vi.doUnmock('../llm.js')
      vi.doUnmock('../shell.js')
      vi.resetModules()
    }
  })

  it('loads context from --context-file before falling back to legacy context readers', async () => {
    const origArgv = process.argv
    const context = {
      lastCommand: 'git brnch',
      exitCode: 1,
      errorOutput: 'git: brnch is not a git command',
      cwd: '/repo',
      shell: 'zsh' as const,
      os: 'darwin' as const,
      timestamp: '2026-06-07T00:00:00.000Z',
    }
    const ensureConfig = vi.fn().mockResolvedValue('ready')
    const readContext = vi.fn().mockResolvedValue(null)
    const readContextFromPath = vi.fn().mockResolvedValue(context)
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'git branch', confidence: 'high' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('../config.js', () => ({ ensureConfig }))
      vi.doMock('../context.js', () => ({ readContext, readContextFromPath }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      process.argv = ['node', 'ffix', '--context-file', '/tmp/fuck_ctx.json']

      const mod = await import('../main.js')
      const exitCode = await mod.main()

      expect(exitCode).toBe(0)
      expect(readContextFromPath).toHaveBeenCalledWith('/tmp/fuck_ctx.json')
      expect(readContext).not.toHaveBeenCalled()
      expect(getFixSuggestion).toHaveBeenCalledWith(context)
      expect(consoleSpy).toHaveBeenCalledWith('git branch')
    } finally {
      process.argv = origArgv
      consoleSpy.mockRestore()
      vi.doUnmock('../config.js')
      vi.doUnmock('../context.js')
      vi.doUnmock('../llm.js')
      vi.doUnmock('../shell.js')
      vi.resetModules()
    }
  })

  it('loads zsh context from --context-file on darwin and passes it to the LLM', async () => {
    const origArgv = process.argv
    const origPlatform = process.platform
    const context = {
      lastCommand: 'brew udpate',
      exitCode: 1,
      errorOutput: 'zsh: command not found: udpate',
      cwd: '/Users/test/repo',
      shell: 'zsh' as const,
      os: 'darwin' as const,
      timestamp: '2026-06-07T00:00:00.000Z',
    }
    const ensureConfig = vi.fn().mockResolvedValue('ready')
    const readContext = vi.fn().mockResolvedValue(null)
    const readContextFromPath = vi.fn().mockResolvedValue(context)
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'brew update', confidence: 'high' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('../config.js', () => ({ ensureConfig }))
      vi.doMock('../context.js', () => ({ readContext, readContextFromPath }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      process.argv = ['node', 'ffix', '--context-file', '/tmp/ffix_ctx.json', '--json']

      const mod = await import('../main.js')
      const exitCode = await mod.main()

      expect(exitCode).toBe(0)
      expect(process.platform).toBe('darwin')
      expect(readContextFromPath).toHaveBeenCalledWith('/tmp/ffix_ctx.json')
      expect(readContext).not.toHaveBeenCalled()
      expect(getFixSuggestion).toHaveBeenCalledWith(context)
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ command: 'brew update', confidence: 'high' }))
    } finally {
      process.argv = origArgv
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
      consoleSpy.mockRestore()
      vi.doUnmock('../config.js')
      vi.doUnmock('../context.js')
      vi.doUnmock('../llm.js')
      vi.doUnmock('../shell.js')
      vi.resetModules()
    }
  })

  it('returns 1 when --context-file is combined with legacy context args', async () => {
    const origArgv = process.argv
    const ensureConfig = vi.fn().mockResolvedValue('ready')
    const readContext = vi.fn().mockResolvedValue(null)
    const readContextFromPath = vi.fn().mockResolvedValue(null)
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'git branch', confidence: 'high' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('../config.js', () => ({ ensureConfig }))
      vi.doMock('../context.js', () => ({ readContext, readContextFromPath }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      process.argv = ['node', 'ffix', '--context-file', '/tmp/fuck_ctx.json', '--cmd', 'git brnch']

      const mod = await import('../main.js')
      const exitCode = await mod.main()

      expect(exitCode).toBe(1)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cannot combine --context-file'))
      expect(ensureConfig).not.toHaveBeenCalled()
      expect(readContextFromPath).not.toHaveBeenCalled()
      expect(readContext).not.toHaveBeenCalled()
      expect(getFixSuggestion).not.toHaveBeenCalled()
    } finally {
      process.argv = origArgv
      consoleSpy.mockRestore()
      vi.doUnmock('../config.js')
      vi.doUnmock('../context.js')
      vi.doUnmock('../llm.js')
      vi.doUnmock('../shell.js')
      vi.resetModules()
    }
  })

  it('returns 1 when getFixSuggestion returns low confidence', async () => {
    const origArgv = process.argv
    const ensureConfig = vi.fn().mockResolvedValue('ready')
    const readContext = vi.fn().mockResolvedValue({
      lastCommand: 'git brnch',
      exitCode: 1,
      errorOutput: 'git: brnch is not a git command',
      cwd: '/repo',
      shell: 'powershell-7' as const,
      os: 'win32' as const,
      timestamp: '2026-06-07T00:00:00.000Z',
    })
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'git branch', confidence: 'low' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('../config.js', () => ({ ensureConfig }))
      vi.doMock('../context.js', () => ({ readContext }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      process.argv = ['node', 'ffix']

      const mod = await import('../main.js')
      const exitCode = await mod.main()

      expect(exitCode).toBe(1)
      expect(getFixSuggestion).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没能找到修复方案'))
    } finally {
      process.argv = origArgv
      consoleSpy.mockRestore()
      vi.doUnmock('../config.js')
      vi.doUnmock('../context.js')
      vi.doUnmock('../llm.js')
      vi.doUnmock('../shell.js')
      vi.resetModules()
    }
  })
})
