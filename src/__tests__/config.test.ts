import { describe, it, expect, vi, afterEach } from 'vitest'

async function importConfigWithRaw(raw: string) {
  const readFile = vi.fn().mockResolvedValue(raw)

  vi.resetModules()
  vi.doMock('node:fs/promises', () => ({
    readFile,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  }))

  const mod = await import('../config.js')
  return { ...mod, readFile }
}

afterEach(() => {
  vi.doUnmock('node:fs/promises')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('validateUserConfig()', () => {
  it('accepts a valid config', async () => {
    const { validateUserConfig } = await importConfigWithRaw('{}')

    const errors = validateUserConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
    })

    expect(errors).toHaveLength(0)
  })
})

describe('loadUserConfig()', () => {
  it('prints apiKey validation error and exits without leaking apiKey value', async () => {
    const { loadUserConfig } = await importConfigWithRaw(JSON.stringify({
      baseUrl: 'https://api.example.com',
      model: 'gpt-test',
    }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadUserConfig()

    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toContain('apiKey')
    expect(output).not.toContain('sk-test')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('prints model validation error and exits for an empty model', async () => {
    const { loadUserConfig } = await importConfigWithRaw(JSON.stringify({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: '   ',
    }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadUserConfig()

    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toContain('model')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('prints baseUrl validation error and exits for an invalid URL', async () => {
    const { loadUserConfig } = await importConfigWithRaw(JSON.stringify({
      baseUrl: 'not-a-url',
      apiKey: 'sk-test',
      model: 'gpt-test',
    }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadUserConfig()

    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toContain('baseUrl')
    expect(output).toContain('绝对 URL')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('prints one validation error per missing field and exits', async () => {
    const { loadUserConfig } = await importConfigWithRaw(JSON.stringify({}))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadUserConfig()

    const output = errorSpy.mock.calls.flat().join('\n')
    expect(errorSpy).toHaveBeenCalledTimes(3)
    expect(output).toContain('baseUrl')
    expect(output).toContain('apiKey')
    expect(output).toContain('model')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('returns merged config and does not exit for a valid config', async () => {
    const { loadUserConfig } = await importConfigWithRaw(JSON.stringify({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
    }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const config = await loadUserConfig()

    expect(config).toEqual({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
    })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('prints a friendly parse error and exits for corrupted JSON', async () => {
    const { loadUserConfig } = await importConfigWithRaw('{not valid json')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadUserConfig()

    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toContain('配置文件')
    expect(output).toContain('JSON')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
