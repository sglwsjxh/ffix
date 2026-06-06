import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

let keyPress: (...args: any[]) => any

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
      ;(process.stdin as any).setRawMode = undefined

      const result = await keyPress()
      expect(result).toBe('')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      ;(process.stdin as any).setRawMode = origSetRawMode
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
      process.stdin.setRawMode = vi.fn()
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
      process.stdin.setRawMode = origSetRawMode
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
      process.stdin.setRawMode = vi.fn()
      process.stdin.resume = vi.fn()
      process.stdin.pause = vi.fn()
      process.stdin.once = vi.fn((_event: string, handler: Function) => {
        setTimeout(() => handler(Buffer.from('\x03')), 10)
        return process.stdin
      })

      await keyPress()
      expect(process.exit).toHaveBeenCalledWith(130)
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('已取消'))
    } finally {
      stderrSpy.mockRestore()
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      process.stdin.setRawMode = origSetRawMode
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
      process.stdin.setRawMode = vi.fn(() => { throw new Error('raw mode failed') })

      await expect(keyPress()).rejects.toThrow('raw mode failed')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY?.value, configurable: true })
      process.stdin.setRawMode = origSetRawMode
    }
  })
})
