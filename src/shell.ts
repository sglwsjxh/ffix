import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
  const nodeCliLine = cliPath
    ? `$Fuck_NodeCli = "${cliPath}"`
    : `$Fuck_NodeCli = "$(npm root -g)\\@sglwsjxh\\ffix\\dist\\main.js"`

  return `# >>> fuck init >>>

# CLI 入口路径
${nodeCliLine}

# 采集失败命令的上下文到临时文件
function Write-FuckContext {
    # 函数开头立刻保存关键状态，避免后续命令覆盖
    $lastSuccess = $?
    $exitCode = $global:LASTEXITCODE

    # Channel A: 会话历史（快速路径）
    $lastCmd = Get-History -Count 1 | Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue | Where-Object { $_ -and ($_ -notmatch '^\s*fuck(\s|$)') }

    # Channel B: PSReadLine 历史文件回退（解决 PS7 异步历史导致 Get-History 返回 null 的问题）
    if (-not $lastCmd) {
        try {
            $option = Get-PSReadLineOption -ErrorAction Stop
            $historyPath = $option.HistorySavePath
            if ($historyPath -and (Test-Path $historyPath)) {
                $lines = Get-Content $historyPath -Tail 20 -ErrorAction Stop
                $lastCmd = $lines |
                    Where-Object { $_ -and ($_ -notmatch '^\s*fuck(\s|$)') } |
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
            timestamp   = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffZ')
        }
        $ctx | ConvertTo-Json -Compress | Out-File -FilePath "$env:TEMP\\fuck_ctx_$($Host.InstanceId).json" -Encoding utf8
    }
}

# 保存原始 prompt 函数，确保不破坏用户自定义的 prompt
$Fuck_OriginalPrompt = \${function:prompt}

# 重写 prompt 函数：在每次显示提示符前采集上下文，然后恢复原始行为
function prompt {
    Write-FuckContext
    & $Fuck_OriginalPrompt
}

# fuck 命令：读取上下文 → 调用 CLI（带确认）→ 捕获 stdout → iex 执行
function fuck {
    $ctxPath = "$env:TEMP\\fuck_ctx_$($Host.InstanceId).json"
    if (-not (Test-Path $ctxPath)) {
        Write-Host "没有找到上一条命令的上下文"
        return
    }

    $ctx = Get-Content $ctxPath -Raw | ConvertFrom-Json
    if (-not $ctx) {
        Write-Host "没有找到上一条命令的上下文"
        return
    }

    # 读取后立即删除，避免被下一轮 prompt hook 覆盖
    Remove-Item $ctxPath -Force -ErrorAction SilentlyContinue

    $command = & node "$Fuck_NodeCli" --cmd "$($ctx.lastCommand)" --exit-code $ctx.exitCode --error-output "$($ctx.errorOutput)" --cwd "$($ctx.cwd)" --confirm

    if (-not [string]::IsNullOrWhiteSpace($command)) {
        iex "$command"
    }

    [Console]::ResetColor()
}

# <<< fuck init <<<`
}

/**
 * 将 fuck 注入到当前用户的 $PROFILE 中
 * 先备份原文件，再追加注入脚本
 * 如果已经注入过则跳过
 */
export async function install(): Promise<void> {
  const profilePath = getProfilePath()

  await mkdir(dirname(profilePath), { recursive: true })

  let content = ''
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch (err) {
    /* first install: $PROFILE may not exist yet, that's OK */
  }

  if (content.includes('# >>> fuck init >>>')) {
    console.log('fuck 已经安装到 $PROFILE，跳过')
    return
  }

  await writeFile(profilePath + '.bak', content, 'utf-8')

  const cliPath = fileURLToPath(import.meta.url)
  const script = generateProfileScript(cliPath)
  const separator = content ? '\n' : ''
  await writeFile(profilePath, content + separator + script, 'utf-8')

  console.log(`已安装到 ${profilePath}`)
}

/**
 * 从 $PROFILE 中卸载 fuck 注入内容
 * 只删除标记块之间的内容，不影响用户其他配置
 */
export async function uninstall(): Promise<void> {
  const profilePath = getProfilePath()

  let content: string
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch {
    console.log('没有找到 $PROFILE')
    return
  }

  const startTag = '# >>> fuck init >>>'
  const endTag = '# <<< fuck init <<<'

  const startIdx = content.indexOf(startTag)
  if (startIdx === -1) {
    console.log('没有找到 fuck 注入内容')
    return
  }

  const endIdx = content.indexOf(endTag, startIdx)
  if (endIdx === -1) {
    console.log('错误：注入标记不完整，请手动检查 $PROFILE')
    return
  }

  // 提取标记块前后的内容，合并回文件
  const before = content.substring(0, startIdx)
  const after = content.substring(endIdx + endTag.length)
  const trimmed = after.startsWith('\r\n')
    ? after.substring(2)
    : after.startsWith('\n')
      ? after.substring(1)
      : after

  await writeFile(profilePath, before + trimmed, 'utf-8')
  console.log('已从 $PROFILE 卸载')
}
