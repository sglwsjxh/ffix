import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node:child_process')
vi.mock('node:fs/promises')

import { generateProfileScript, getProfilePath, install } from '../shell.js'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

describe('generateProfileScript()', () => {
  it('matches $Error[0] only for the current command via InvocationInfo.Line', () => {
    const script = generateProfileScript()
    expect(script).toContain('$Error[0].InvocationInfo.Line -eq $lastCmd')
  })

  it('uses PowerShell host instance id to isolate temp context files per session', () => {
    const script = generateProfileScript()
    const isolatedPath = '$env:TEMP\\fuck_ctx_$($Host.InstanceId).json'

    expect(script).toContain('$Host.InstanceId')
    expect(script).toContain(`Out-File -FilePath "${isolatedPath}"`)
    expect(script).toContain(`$ctxPath = "${isolatedPath}"`)
  })

  it('uses provided cliPath instead of npm root -g fallback', () => {
    const cliPath = '/path/to/dist/main.js'
    const script = generateProfileScript(cliPath)
    expect(script).toContain(`$Fuck_NodeCli = "${cliPath}"`)
    expect(script).not.toContain('npm root -g')
  })
})

describe('getProfilePath()', () => {
  const mockProfilePath = 'C:\\Users\\test\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1'

  it('returns the path from $PROFILE via execFileSync', () => {
    vi.mocked(execFileSync).mockReturnValueOnce(mockProfilePath + '\n')

    const result = getProfilePath()
    expect(result).toBe(mockProfilePath)
    expect(execFileSync).toHaveBeenCalledWith('powershell', [
      '-NoProfile', '-Command', 'Write-Output $PROFILE'
    ], expect.objectContaining({ encoding: 'utf-8' }))
  })

  it('throws descriptive error when powershell fails', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('ENOENT') })

    expect(() => getProfilePath()).toThrow(/无法获取 PowerShell \$PROFILE 路径/)
  })

  it('throws descriptive error when $PROFILE is empty', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('\n')

    expect(() => getProfilePath()).toThrow(/无法获取 PowerShell \$PROFILE 路径/)
  })
})

describe('install()', () => {
  const mockProfilePath = 'C:\\Users\\test\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1'
  const mockParentDir = 'C:\\Users\\test\\Documents\\PowerShell'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execFileSync).mockReturnValue(mockProfilePath + '\n')
    vi.mocked(readFile).mockRejectedValue(new Error('file not found'))
    vi.mocked(writeFile).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
  })

  it('creates the parent directory of the resolved $PROFILE path', async () => {
    await install()

    expect(mkdir).toHaveBeenCalledWith(mockParentDir, { recursive: true })
    expect(mkdir).toHaveBeenCalledTimes(1)
  })
})
