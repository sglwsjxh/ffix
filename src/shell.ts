import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export function getProfilePath(): string {
  try {
    // Try pwsh (PowerShell 7) first, fall back to powershell (Windows PowerShell 5.1)
    const psExe = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh'
    const fallbackExe = process.platform === 'win32' ? 'powershell.exe' : 'powershell'

    let output: string
    try {
      output = execFileSync(psExe, [
        '-NoProfile',
        '-Command',
        'Write-Output $PROFILE'
      ], { encoding: 'utf-8', timeout: 10000 })
    } catch {
      output = execFileSync(fallbackExe, [
        '-NoProfile',
        '-Command',
        'Write-Output $PROFILE'
      ], { encoding: 'utf-8', timeout: 10000 })
    }

    const path = output.trim()
    if (!path) throw new Error('PowerShell returned empty $PROFILE path')
    return path
  } catch (err) {
    throw new Error(
      `无法获取 PowerShell $PROFILE 路径: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export function getZshProfilePath(): string {
  const zdotdir = process.env.ZDOTDIR
  return join(zdotdir || homedir(), '.zshrc')
}

function openTag(): string {
  return '# >>> fuck init >>>'
}

function closeTag(): string {
  return '# <<< fuck init <<<'
}

function zshOpenTag(): string {
  return '# >>> ffix init >>>'
}

function zshCloseTag(): string {
  return '# <<< ffix init <<<'
}

function psPathVar(cliPath?: string): string {
  return cliPath
    ? `$Fuck_NodeCli = "${cliPath}"`
    : `$Fuck_NodeCli = "$(npm root -g)\\@sglwsjxh\\ffix\\dist\\main.js"`
}

function zshPathVar(cliPath?: string): string {
  return cliPath
    ? `FFIX_NODE_CLI="${cliPath}"`
    : 'FFIX_NODE_CLI="$(npm root -g)/@sglwsjxh/ffix/dist/main.js"'
}

function psPathBlock(cliPath?: string): string {
  return `${psPathVar(cliPath)}`
}

function captureBlock(): string {
  return `function Write-FuckContext {
    $lastSuccess = $?
    $exitCode = $global:LASTEXITCODE

    # Channel A: 会话历史
    $lastCmd = Get-History -Count 1 | Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue | Where-Object { $_ -and ($_ -notmatch '^\\s*fuck(\\s|$)') }

    # Channel B: PSReadLine 历史文件回退
    if (-not $lastCmd) {
        try {
            $option = Get-PSReadLineOption -ErrorAction Stop
            $historyPath = $option.HistorySavePath
            if ($historyPath -and (Test-Path $historyPath)) {
                $lines = Get-Content $historyPath -Tail 20 -ErrorAction Stop
                $lastCmd = $lines |
                    Where-Object { $_ -and ($_ -notmatch '^\\s*fuck(\\s|$)') } |
                    Select-Object -Last 1
            }
        } catch {
        }
    }

    if (-not $lastCmd) { return }

    if (-not $lastSuccess) {
        $effectiveExitCode = if ($exitCode -ne 0) { $exitCode } else { 1 }
        $errorMsg = if ($Error[0] -and $Error[0].InvocationInfo.Line -eq $lastCmd) { $Error[0].Exception.Message } else { '' }
        $ctx = @{
            lastCommand = $lastCmd
            exitCode    = $effectiveExitCode
            errorOutput = $errorMsg
            cwd         = (Get-Location).Path
            shell       = 'powershell-7'
            os          = 'win32'
            timestamp   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        }
        $ctx | ConvertTo-Json -Compress | Out-File -FilePath "$env:TEMP\\fuck_ctx_$($Host.InstanceId).json" -Encoding utf8
    }
}`
}

function promptBlock(): string {
  return `$Fuck_OriginalPrompt = \${function:prompt}

function prompt {
    Write-FuckContext
    & $Fuck_OriginalPrompt
}`
}

function fuckBlock(): string {
  return `function fuck {
    if ($args.Count -gt 0) {
        & node "$Fuck_NodeCli" @args
        return
    }

    $ctxPath = "$env:TEMP\\fuck_ctx_$($Host.InstanceId).json"
    if (-not (Test-Path $ctxPath)) {
        Write-Host "没有找到上一条命令的上下文"
        return
    }

    $command = & node "$Fuck_NodeCli" --context-file "$ctxPath" --confirm

    if (-not [string]::IsNullOrWhiteSpace($command)) {
        iex "$command"
    }

    [Console]::ResetColor()
}`
}

function zshPathBlock(cliPath?: string): string {
  return `${zshPathVar(cliPath)}`
}

function zshCtxBlock(): string {
  return `: \${FFIX_CTX_PATH:="\${TMPDIR:-/tmp}/ffix_ctx_$$.json"}`
}

function zshHookBlock(): string {
  return `ffix_preexec() {
    FFIX_LAST_CMD="$1"
}

ffix_json_escape() {
    local s="$1"
    s="\${s//\\/\\\\}"
    s="\${s//\"/\\\"}"
    s="\${s//\$'\\n'/\\\\n}"
    s="\${s//\$'\\t'/\\\\t}"
    printf '%s' "$s"
}

ffix_precmd() {
    local exit_code=$?
    if [[ $exit_code -ne 0 && "$FFIX_LAST_CMD" != "fuck"* ]]; then
        local escaped_cmd
        local escaped_cwd
        escaped_cmd=$(ffix_json_escape "\${FFIX_LAST_CMD:-}")
        escaped_cwd=$(ffix_json_escape "\${PWD:-}")
        local ctx
        ctx=$(printf '{"lastCommand":"%s","exitCode":%d,"errorOutput":"","cwd":"%s","shell":"zsh","os":"darwin","timestamp":"%s"}' \\
            "$escaped_cmd" \\
            "$exit_code" \\
            "$escaped_cwd" \\
            "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)")
        printf '%s\\n' "$ctx" > "$FFIX_CTX_PATH"
    fi
    return 0
}

autoload -Uz add-zsh-hook && add-zsh-hook preexec ffix_preexec && add-zsh-hook precmd ffix_precmd`
}

function zshFuckBlock(): string {
  return `fuck() {
    if [[ $# -gt 0 ]]; then
        node "$FFIX_NODE_CLI" "$@"
        return
    fi

    local ctxPath="$FFIX_CTX_PATH"
    if [[ ! -f "$ctxPath" ]]; then
        echo "没有找到上一条命令的上下文"
        return
    fi

    local suggestion
    suggestion=$(node "$FFIX_NODE_CLI" --context-file "$ctxPath" --confirm)

    if [[ -n "$suggestion" ]]; then
        eval "$suggestion"
    fi
}`
}

export function generateProfileScript(cliPath?: string): string {
  return [
    openTag(),
    psPathBlock(cliPath),
    captureBlock(),
    promptBlock(),
    fuckBlock(),
    closeTag(),
  ].join('\n\n')
}

export function generateZshProfileScript(cliPath?: string): string {
  return [
    zshOpenTag(),
    zshPathBlock(cliPath),
    zshCtxBlock(),
    zshHookBlock(),
    zshFuckBlock(),
    zshCloseTag(),
  ].join('\n\n')
}

async function appendBlock(
  profilePath: string,
  startTag: string,
  script: string,
  installedMsg: string,
  doneMsg: string,
): Promise<void> {
  await mkdir(dirname(profilePath), { recursive: true })

  let content = ''
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch (err) {
  }

  if (content.includes(startTag)) {
    console.log(installedMsg)
    return
  }

  await writeFile(profilePath + '.bak', content, 'utf-8')

  const separator = content ? '\n' : ''
  await writeFile(profilePath, content + separator + script, 'utf-8')

  console.log(doneMsg)
}

async function removeBlock(
  profilePath: string,
  startTag: string,
  endTag: string,
  noProfileMsg: string,
  noBlockMsg: string,
  brokenBlockMsg: string,
  doneMsg: string,
): Promise<void> {
  let content: string
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch (err) {
    console.log(noProfileMsg)
    return
  }

  const startIdx = content.indexOf(startTag)
  if (startIdx === -1) {
    console.log(noBlockMsg)
    return
  }

  const endIdx = content.indexOf(endTag, startIdx)
  if (endIdx === -1) {
    console.log(brokenBlockMsg)
    return
  }

  const before = content.substring(0, startIdx)
  const after = content.substring(endIdx + endTag.length)
  const trimmed = after.startsWith('\r\n')
    ? after.substring(2)
    : after.startsWith('\n')
      ? after.substring(1)
      : after

  await writeFile(profilePath, before + trimmed, 'utf-8')
  console.log(doneMsg)
}

export async function install(): Promise<void> {
  if (process.platform === 'darwin') {
    await installZsh()
  } else {
    await installPS()
  }
}

function resolveCliPath(): string {
  const currentPath = fileURLToPath(import.meta.url)
  const pkgDir = dirname(dirname(currentPath))
  const distPath = join(pkgDir, 'dist', 'main.js')
  return existsSync(distPath) ? distPath : currentPath
}

export async function installPS(): Promise<void> {
  const profilePath = getProfilePath()
  const cliPath = resolveCliPath()
  const script = generateProfileScript(cliPath)
  await appendBlock(
    profilePath,
    openTag(),
    script,
    'fuck 已经安装到 $PROFILE，跳过',
    `已安装到 ${profilePath}`,
  )
}

export async function installZsh(): Promise<void> {
  const profilePath = getZshProfilePath()
  const cliPath = resolveCliPath()
  const script = generateZshProfileScript(cliPath)
  await appendBlock(
    profilePath,
    zshOpenTag(),
    script,
    'ffix 已经安装到 .zshrc，跳过',
    `已安装到 ${profilePath}`,
  )
}

export async function uninstall(): Promise<void> {
  if (process.platform === 'darwin') {
    await uninstallZsh()
  } else {
    await uninstallPS()
  }
}

export async function uninstallPS(): Promise<void> {
  const profilePath = getProfilePath()

  const startTag = '# >>> fuck init >>>'
  const endTag = '# <<< fuck init <<<'
  await removeBlock(
    profilePath,
    startTag,
    endTag,
    '没有找到 $PROFILE',
    '没有找到 fuck 注入内容',
    '错误：注入标记不完整，请手动检查 $PROFILE',
    '已从 $PROFILE 卸载',
  )
}

export async function uninstallZsh(): Promise<void> {
  const profilePath = getZshProfilePath()
  await removeBlock(
    profilePath,
    zshOpenTag(),
    zshCloseTag(),
    '没有找到 .zshrc',
    '没有找到 ffix 注入内容',
    '错误：注入标记不完整，请手动检查 .zshrc',
    '已从 .zshrc 卸载',
  )
}
