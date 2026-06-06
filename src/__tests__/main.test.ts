import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

let keyPress: () => Promise<string>

beforeAll(async () => {
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const mod = await import('../main.js')
  keyPress = mod.keyPress
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

describe('main()', () => {
  it('creates missing config and exits before reading context or calling LLM', async () => {
    const origArgv = process.argv
    const readFile = vi.fn().mockRejectedValue(new Error('config missing'))
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const readContext = vi.fn().mockResolvedValue(null)
    const getFixSuggestion = vi.fn().mockResolvedValue({ command: 'echo nope' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      vi.resetModules()
      vi.doMock('node:fs/promises', () => ({ readFile, writeFile, mkdir }))
      vi.doMock('../context.js', () => ({ readContext }))
      vi.doMock('../llm.js', () => ({ getFixSuggestion }))
      vi.doMock('../shell.js', () => ({ install: vi.fn(), uninstall: vi.fn() }))
      process.argv = ['node', 'ffix']

      const mod = await import('../main.js')
      await mod.main()

      expect(readFile).toHaveBeenCalled()
      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      expect(writeFile).toHaveBeenCalled()
      expect(process.exit).toHaveBeenCalledWith(0)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('请编辑 config/config.json 配置文件后重新运行'))
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
})
