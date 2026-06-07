import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('node:child_process')
vi.mock('node:fs/promises')

import {
  generateProfileScript,
  generateZshProfileScript,
  getProfilePath,
  getZshProfilePath,
  install,
  uninstall,
} from '../shell.js'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const originalPlatform = process.platform

function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  mockPlatform(originalPlatform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

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

  it('passes context file path to CLI instead of expanding JSON into legacy args', () => {
    const script = generateProfileScript()

    expect(script).toContain('& node "$Fuck_NodeCli" --context-file "$ctxPath" --confirm')
    expect(script).not.toContain('Get-Content $ctxPath -Raw | ConvertFrom-Json')
    expect(script).not.toContain('Remove-Item $ctxPath')
    expect(script).not.toContain('--cmd "$($ctx.lastCommand)"')
    expect(script).not.toContain('--exit-code $ctx.exitCode')
    expect(script).not.toContain('--error-output "$($ctx.errorOutput)"')
    expect(script).not.toContain('--cwd "$($ctx.cwd)"')
  })

  it('uses provided cliPath instead of npm root -g fallback', () => {
    const cliPath = '/path/to/dist/main.js'
    const script = generateProfileScript(cliPath)
    expect(script).toContain(`$Fuck_NodeCli = "${cliPath}"`)
    expect(script).not.toContain('npm root -g')
  })
})

describe('generateZshProfileScript()', () => {
  it('generates a zsh marker block with hooks and context-file transport', () => {
    const script = generateZshProfileScript('/path/to/dist/main.js')

    expect(script).toContain('# >>> ffix init >>>')
    expect(script).toContain('# <<< ffix init <<<')
    expect(script).toContain('FFIX_NODE_CLI="/path/to/dist/main.js"')
    expect(script).toContain(': ${FFIX_CTX_PATH:="${TMPDIR:-/tmp}/ffix_ctx_$$.json"}')
    expect(script).toContain('ffix_preexec()')
    expect(script).toContain('ffix_precmd()')
    expect(script).toContain('autoload -Uz add-zsh-hook && add-zsh-hook preexec ffix_preexec && add-zsh-hook precmd ffix_precmd')
    expect(script).toContain('node "$FFIX_NODE_CLI" --context-file "$ctxPath" --confirm')
    expect(script).toContain('eval "$suggestion"')
  })

  it('captures the raw zsh preexec command into a module-level variable', () => {
    const script = generateZshProfileScript()

    expect(script).toContain('ffix_preexec() {\n    # 保存用户输入的原始命令')
    expect(script).toContain('FFIX_LAST_CMD="$1"')
  })

  it('writes failed zsh command context JSON from precmd using FFIX_CTX_PATH', () => {
    const script = generateZshProfileScript()

    expect(script).toContain('ffix_precmd() {\n    local exit_code=$?')
    expect(script).toContain('if [[ $exit_code -ne 0 && "$FFIX_LAST_CMD" != "fuck"* ]]; then')
    expect(script).toContain('ctx=$(printf \'{"lastCommand":"%s","exitCode":%d,"errorOutput":"","cwd":"%s","shell":"zsh","os":"darwin","timestamp":"%s"}\' \\')
    expect(script).toContain('"${FFIX_LAST_CMD:-}"')
    expect(script).toContain('"${PWD:-}"')
    expect(script).toContain('"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"')
    expect(script).toContain('printf \'%s\\n\' "$ctx" > "$FFIX_CTX_PATH"')
    expect(script).toContain('return 0')
  })

  it('uses add-zsh-hook rather than overwriting top-level zsh hook functions', () => {
    const script = generateZshProfileScript()

    expect(script).toContain('add-zsh-hook preexec ffix_preexec')
    expect(script).toContain('add-zsh-hook precmd ffix_precmd')
    expect(script).not.toContain('\npreexec()')
    expect(script).not.toContain('\nprecmd()')
  })

  it('uses npm root -g fallback when cliPath is not provided', () => {
    const script = generateZshProfileScript()

    expect(script).toContain('FFIX_NODE_CLI="$(npm root -g)/@sglwsjxh/ffix/dist/main.js"')
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

describe('getZshProfilePath()', () => {
  it('uses ZDOTDIR when it is set', () => {
    vi.stubEnv('ZDOTDIR', 'C:\\custom\\zdotdir')

    expect(getZshProfilePath()).toBe('C:\\custom\\zdotdir\\.zshrc')
  })

  it('falls back to home .zshrc when ZDOTDIR is not set', () => {
    vi.stubEnv('ZDOTDIR', '')

    expect(getZshProfilePath()).toMatch(/[\\/]\.zshrc$/)
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
    mockPlatform('win32')

    await install()

    expect(mkdir).toHaveBeenCalledWith(mockParentDir, { recursive: true })
    expect(mkdir).toHaveBeenCalledTimes(1)
  })

  it('routes darwin installs to .zshrc without resolving PowerShell $PROFILE', async () => {
    mockPlatform('darwin')
    vi.stubEnv('ZDOTDIR', 'C:\\Users\\test\\.config\\zsh')

    await install()

    expect(execFileSync).not.toHaveBeenCalled()
    expect(mkdir).toHaveBeenCalledWith('C:\\Users\\test\\.config\\zsh', { recursive: true })
    expect(writeFile).toHaveBeenCalledWith('C:\\Users\\test\\.config\\zsh\\.zshrc.bak', '', 'utf-8')
    expect(writeFile).toHaveBeenLastCalledWith(
      'C:\\Users\\test\\.config\\zsh\\.zshrc',
      expect.stringContaining('# >>> ffix init >>>'),
      'utf-8',
    )
  })
})

describe('uninstall()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readFile).mockResolvedValue('before\n# >>> ffix init >>>\nblock\n# <<< ffix init <<<\nafter')
    vi.mocked(writeFile).mockResolvedValue(undefined)
  })

  it('routes darwin uninstalls to the zsh marker block', async () => {
    mockPlatform('darwin')
    vi.stubEnv('ZDOTDIR', 'C:\\Users\\test\\.config\\zsh')

    await uninstall()

    expect(execFileSync).not.toHaveBeenCalled()
    expect(readFile).toHaveBeenCalledWith('C:\\Users\\test\\.config\\zsh\\.zshrc', 'utf-8')
    expect(writeFile).toHaveBeenCalledWith('C:\\Users\\test\\.config\\zsh\\.zshrc', 'before\nafter', 'utf-8')
  })
})
