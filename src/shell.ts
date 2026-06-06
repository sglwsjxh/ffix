import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

function getProfilePath(): string {
  return join(homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
}

/**
 * 检测当前是否在 PowerShell 7 环境中运行
 * 通过检查 PSModulePath 环境变量是否包含 "PowerShell\" 来判断
 */
export async function detectPs7(): Promise<boolean> {
  return (process.env.PSModulePath ?? '').includes('PowerShell\\')
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
export function generateProfileScript(): string {
  return `# >>> fuck init >>>

# CLI 入口路径（通过 npm root -g 动态获取，不写死路径）
$Fuck_NodeCli = "$(npm root -g)\\@sglwsjxh\\fuck\\dist\\main.js"

# 采集失败命令的上下文到临时文件
function Write-FuckContext {
    $lastCmd = Get-History -Count 1 | Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue
    if (-not $lastCmd) { return }

    $exitCode = $global:LASTEXITCODE
    $errorMsg = if ($Error[0]) { $Error[0].Exception.Message } else { '' }

    if ($exitCode -ne 0) {
        $ctx = @{
            lastCommand = $lastCmd
            exitCode    = $exitCode
            errorOutput = $errorMsg
            cwd         = (Get-Location).Path
            shell       = 'powershell-7'
            os          = 'win32'
            timestamp   = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffZ')
        }
        $ctx | ConvertTo-Json -Compress | Out-File -FilePath "$env:TEMP\\fuck_ctx.json" -Encoding utf8
    }
}

# 保存原始 prompt 函数，确保不破坏用户自定义的 prompt
$Fuck_OriginalPrompt = \${function:prompt}

# 重写 prompt 函数：在每次显示提示符前采集上下文，然后恢复原始行为
function prompt {
    Write-FuckContext
    & $Fuck_OriginalPrompt
}

# fuck 命令：读取上下文 → 调用 LLM → 展示建议 → 用户确认执行
function fuck {
    $ctxPath = "$env:TEMP\\fuck_ctx.json"
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

    # 检查 CLI 入口是否存在
    if (-not (Test-Path $Fuck_NodeCli)) {
        Write-Host "找不到 CLI 入口：$Fuck_NodeCli"
        Write-Host "请执行 'npm i -g @sglwsjxh/fuck@latest' 重新安装"
        return
    }

    # 调用 Node CLI 获取修复建议
    $result = & node "$Fuck_NodeCli" --cmd "$($ctx.lastCommand)" --exit-code $ctx.exitCode --error-output "$($ctx.errorOutput)" --cwd "$($ctx.cwd)" --json
    $rawJson = $result | Out-String
    $suggestion = $rawJson | ConvertFrom-Json

    if (-not $suggestion.command) {
        Write-Host "没能找到修复方案"
        return
    }

    Write-Host "✦ 上一条命令：$($ctx.lastCommand)"
    Write-Host ""
    Write-Host "建议执行：$($suggestion.command)"
    Write-Host ""
    Write-Host "Enter = 执行    Ctrl+C = 取消"

    try {
        $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        if ($key.VirtualKeyCode -eq 13) {
            Invoke-Expression $suggestion.command
            [Console]::ResetColor()
        } else {
            Write-Host "已取消"
        }
    } catch {
        Write-Host "已取消"
    }
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

  await mkdir(join(homedir(), 'Documents', 'PowerShell'), { recursive: true })

  let content = ''
  try {
    content = await readFile(profilePath, 'utf-8')
  } catch {
  }

  if (content.includes('# >>> fuck init >>>')) {
    console.log('fuck 已经安装到 $PROFILE，跳过')
    return
  }

  await writeFile(profilePath + '.bak', content, 'utf-8')

  const script = generateProfileScript()
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
