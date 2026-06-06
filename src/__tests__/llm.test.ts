import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FixContext } from '../types.js'

const context: FixContext = {
  lastCommand: 'git brnch',
  exitCode: 1,
  errorOutput: 'git: brnch is not a git command',
  cwd: 'C:\\repo',
  shell: 'powershell-7',
  os: 'win32',
  timestamp: '2026-06-07T00:00:00.000Z',
}

async function importLlmWithResponse(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

  vi.resetModules()
  vi.doMock('../config.js', () => ({
    loadUserConfig: vi.fn().mockResolvedValue({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
    }),
    loadAppConfig: vi.fn().mockResolvedValue({
      stderrTailLines: 40,
      timeoutMs: 1000,
      tempFilePath: '%TEMP%\\fuck_ctx_<session>.json',
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)

  const mod = await import('../llm.js')
  return { getFixSuggestion: mod.getFixSuggestion, fetchMock }
}

function responseWithContent(content: unknown) {
  return {
    choices: [
      {
        message: { content },
      },
    ],
  }
}

afterEach(() => {
  vi.doUnmock('../config.js')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('getFixSuggestion()', () => {
  it('returns parsed FixSuggestion for a valid response', async () => {
    const { getFixSuggestion } = await importLlmWithResponse(responseWithContent(JSON.stringify({
      command: 'git branch',
      confidence: 'high',
    })))

    await expect(getFixSuggestion(context)).resolves.toEqual({
      command: 'git branch',
      confidence: 'high',
    })
  })

  it('returns null when content is null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse(responseWithContent(null))

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('content is not a string'))
  })

  it('returns null when content is empty after trim', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse(responseWithContent('   '))

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('content is empty'))
  })

  it('returns null when content is an object', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse(responseWithContent({ not: 'a string' }))

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('content is not a string'))
  })

  it('returns null when choices array is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse({})

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('choices is missing or empty'))
  })

  it('returns null when choices[0] has no message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse({ choices: [{}] })

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('choices[0].message is missing'))
  })

  it.each([
    { command: 42 },
    { command: { value: 'git branch' } },
  ])('returns null when command is not a string: %o', async (payload) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getFixSuggestion } = await importLlmWithResponse(responseWithContent(JSON.stringify(payload)))

    await expect(getFixSuggestion(context)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('command is not a string'))
  })
})
