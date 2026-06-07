import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export function getProfilePath(): string {
  try {
    const output = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      'Write-Output $PROFILE'
    ], { encoding: 'utf-8', timeout: 10000 })
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

function openingMarker(): string {
  return '# >>> fuck init >>>'
}

function closingMarker(): string {
  return '# <<< fuck init <<<'
}

function zshOpeningMarker(): string {
  return '# >>> ffix init >>>'
}

function zshClosingMarker(): string {
  return '# <<< ffix init <<<'
}

function cliPathValue(cliPath?: string): string {
  return cliPath
    ? `$Fuck_NodeCli = "${cliPath}"`
    : `$Fuck_NodeCli = "$(npm root -g)\\@sglwsjxh\\ffix\\dist\\main.js"`
}

function zshCliPathValue(cliPath?: string): string {
  return cliPath
    ? `FFIX_NODE_CLI="${cliPath}"`
    : 'FFIX_NODE_CLI="$(npm root -g)/@sglwsjxh/ffix/dist/main.js"'
}

function cliPathSection(cliPath?: string): string {
  return `# CLI 入口路径\n${cliPathValue(cliPath)}`
}

function contextCaptureSection(): string {
  return `# 采集失败命令的上下文到临时文件
function Write-FuckContext {
    # 函数开头立刻保存关键状态，避免后续命令覆盖
    $lastSuccess = $?
    $exitCode = $global:LASTEXITCODE

    # Channel A: 会话历史（快速路径）
    $lastCmd = Get-History -Count 1 | Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue | Where-Object { $_ -and ($_ -notmatch '^\\s*fuck(\\s|$)') }

    # Channel B: PSReadLine 历史文件回退（解决 PS7 异步历史导致 Get-History 返回 null 的问题）
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
            # PSReadLine 不可用时静默跳过
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

function promptOverrideSection(): string {
  return `# 保存原始 prompt 函数，确保不破坏用户自定义的 prompt
$Fuck_OriginalPrompt = \${function:prompt}

# 重写 prompt 函数：在每次显示提示符前采集上下文，然后恢复原始行为
function prompt {
    Write-FuckContext
    & $Fuck_OriginalPrompt
}`
}

function fuckCommandSection(): string {
  return `# fuck 命令：读取上下文 → 调用 CLI（带确认）→ 捕获 stdout → iex 执行
function fuck {
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

function zshCliPathSection(cliPath?: string): string {
  return `# CLI 入口路径
${zshCliPathValue(cliPath)}`
}

function zshContextPathSection(): string {
  return `# 会话隔离的上下文文件路径（B2 会填充写入逻辑）
: \${FFIX_CTX_PATH:="\${TMPDIR:-/tmp}/ffix_ctx_$$.json"}`
}

function zshHooksSection(): string {
  return `ffix_preexec() {
    # B2 will capture the command before execution here.
}

ffix_precmd() {
    # B2 will write context JSON here; for v1, errorOutput is ''.
}

autoload -Uz add-zsh-hook && add-zsh-hook preexec ffix_preexec && add-zsh-hook precmd ffix_precmd`
}

function zshFuckCommandSection(): string {
  return `fuck() {
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

/**
 * 生成要注入到 $PROFILE 的 PowerShell 脚本
 * 内容包含：
 * - 标记块 # >>> fuck init >>> / # <<< fuck init <<<
 * - $Fuck_NodeCli 变量（指向 CLI 入口路径）
 * - Write-FuckContext 函数（采集失败命令上下文）
 * - prompt 函数重写（渲染前调用 Write-FuckContext）
 * - fuck 命令（读取上下文 → 调用 LLM → 展示建议 → 确认执行）
 */
export function generateProfileScript(cliPath?: string): string {
  return [
    openingMarker(),
    cliPathSection(cliPath),
    contextCaptureSection(),
    promptOverrideSection(),
    fuckCommandSection(),
    closingMarker(),
  ].join('\n\n')
}

export function generateZshProfileScript(cliPath?: string): string {
  return [
    zshOpeningMarker(),
    zshCliPathSection(cliPath),
    zshContextPathSection(),
    zshHooksSection(),
    zshFuckCommandSection(),
    zshClosingMarker(),
  ].join('\n\n')
}

async function appendProfileBlock(
  profilePath: string,
  startTag: string,
  script: string,
  alreadyInstalledMessage: string,
  installedMessage: string,
): Promise<void> {
  await mkdir(dirname(profilePath), { recursive: true })

  let content = ''
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch (err) {
    /* first install: profile may not exist yet, that's OK */
  }

  if (content.includes(startTag)) {
    console.log(alreadyInstalledMessage)
    return
  }

  await writeFile(profilePath + '.bak', content, 'utf-8')

  const separator = content ? '\n' : ''
  await writeFile(profilePath, content + separator + script, 'utf-8')

  console.log(installedMessage)
}

async function removeProfileBlock(
  profilePath: string,
  startTag: string,
  endTag: string,
  missingProfileMessage: string,
  missingBlockMessage: string,
  incompleteBlockMessage: string,
  uninstalledMessage: string,
): Promise<void> {
  let content: string
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch (err) {
    console.log(missingProfileMessage)
    return
  }

  const startIdx = content.indexOf(startTag)
  if (startIdx === -1) {
    console.log(missingBlockMessage)
    return
  }

  const endIdx = content.indexOf(endTag, startIdx)
  if (endIdx === -1) {
    console.log(incompleteBlockMessage)
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
  console.log(uninstalledMessage)
}

/**
 * 将 fuck 注入到当前用户的 $PROFILE 中
 * 先备份原文件，再追加注入脚本
 * 如果已经注入过则跳过
 */
export async function install(): Promise<void> {
  if (process.platform === 'darwin') {
    await installZsh()
  } else {
    await installPowerShell()
  }
}

export async function installPowerShell(): Promise<void> {
  const profilePath = getProfilePath()
  const cliPath = fileURLToPath(import.meta.url)
  const script = generateProfileScript(cliPath)
  await appendProfileBlock(
    profilePath,
    openingMarker(),
    script,
    'fuck 已经安装到 $PROFILE，跳过',
    `已安装到 ${profilePath}`,
  )
}

export async function installZsh(): Promise<void> {
  const profilePath = getZshProfilePath()
  const cliPath = fileURLToPath(import.meta.url)
  const script = generateZshProfileScript(cliPath)
  await appendProfileBlock(
    profilePath,
    zshOpeningMarker(),
    script,
    'ffix 已经安装到 .zshrc，跳过',
    `已安装到 ${profilePath}`,
  )
}

/**
 * 从 $PROFILE 中卸载 fuck 注入内容
 * 只删除标记块之间的内容，不影响用户其他配置
 */
export async function uninstall(): Promise<void> {
  if (process.platform === 'darwin') {
    await uninstallZsh()
  } else {
    await uninstallPowerShell()
  }
}

export async function uninstallPowerShell(): Promise<void> {
  const profilePath = getProfilePath()

  const startTag = '# >>> fuck init >>>'
  const endTag = '# <<< fuck init <<<'
  await removeProfileBlock(
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
  await removeProfileBlock(
    profilePath,
    zshOpeningMarker(),
    zshClosingMarker(),
    '没有找到 .zshrc',
    '没有找到 ffix 注入内容',
    '错误：注入标记不完整，请手动检查 .zshrc',
    '已从 .zshrc 卸载',
  )
}
