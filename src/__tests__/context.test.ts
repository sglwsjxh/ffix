import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FixContext } from '../types.js'

async function importContextWithFs(readFile: ReturnType<typeof vi.fn>, unlink: ReturnType<typeof vi.fn>) {
  vi.resetModules()
  vi.doMock('node:fs/promises', () => ({ readFile, unlink }))

  const mod = await import('../context.js')
  return { readContextFromPath: mod.readContextFromPath }
}

afterEach(() => {
  vi.doUnmock('node:fs/promises')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('readContextFromPath()', () => {
  it('reads valid JSON and returns FixContext', async () => {
    const ctx: FixContext = {
      lastCommand: 'git brnch',
      exitCode: 1,
      errorOutput: 'git: brnch is not a git command',
      cwd: '/repo',
      shell: 'zsh',
      os: 'darwin',
      timestamp: '2026-06-07T00:00:00.000Z',
    }
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(ctx))
    const unlink = vi.fn().mockResolvedValue(undefined)
    const { readContextFromPath } = await importContextWithFs(readFile, unlink)

    await expect(readContextFromPath('/tmp/fuck_ctx.json')).resolves.toEqual(ctx)
    expect(readFile).toHaveBeenCalledWith('/tmp/fuck_ctx.json', 'utf-8')
  })

  it('returns null for malformed JSON', async () => {
    const readFile = vi.fn().mockResolvedValue('{not valid json')
    const unlink = vi.fn().mockResolvedValue(undefined)
    const { readContextFromPath } = await importContextWithFs(readFile, unlink)

    await expect(readContextFromPath('/tmp/fuck_ctx.json')).resolves.toBeNull()
  })

  it('returns null for missing file', async () => {
    const readFile = vi.fn().mockRejectedValue({ code: 'ENOENT' })
    const unlink = vi.fn().mockResolvedValue(undefined)
    const { readContextFromPath } = await importContextWithFs(readFile, unlink)

    await expect(readContextFromPath('/tmp/missing_ctx.json')).resolves.toBeNull()
  })

  it('returns null for invalid shape', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify({
      lastCommand: 42,
      exitCode: '1',
      errorOutput: '',
      cwd: '/repo',
      shell: 'zsh',
      os: 'darwin',
      timestamp: '2026-06-07T00:00:00.000Z',
    }))
    const unlink = vi.fn().mockResolvedValue(undefined)
    const { readContextFromPath } = await importContextWithFs(readFile, unlink)

    await expect(readContextFromPath('/tmp/fuck_ctx.json')).resolves.toBeNull()
  })

  it('cleans up the context file in its finally block', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify({
      lastCommand: 'git brnch',
      exitCode: 1,
      errorOutput: '',
      cwd: '/repo',
      shell: 'powershell-7',
      os: 'win32',
      timestamp: '2026-06-07T00:00:00.000Z',
    }))
    const unlink = vi.fn().mockResolvedValue(undefined)
    const { readContextFromPath } = await importContextWithFs(readFile, unlink)

    await readContextFromPath('/tmp/fuck_ctx.json')

    expect(unlink).toHaveBeenCalledWith('/tmp/fuck_ctx.json')
    expect(unlink).toHaveBeenCalledOnce()
  })
})
