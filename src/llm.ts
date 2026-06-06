import type { FixContext, FixSuggestion } from './types.js'
import { loadUserConfig, loadAppConfig } from './config.js'

const SYSTEM_PROMPT = `你是一个 PowerShell 7 命令修复助手，分析失败命令并给出修复命令

严格要求：
1. 只返回 JSON，不要多余文字
2. JSON 格式严格固定为 {"command": "修复命令", "confidence": "high|medium|low"}
3. command 必须是 PowerShell 7 可直接执行的一条命令
4. 无法修复时返回 {"command": "", "confidence": "low"}
5. 不要生成 bash/zsh 命令
6. 不要假设用户想安装软件`

function buildUserPrompt(context: FixContext): string {
  return `上一条命令执行失败，以下是上下文：

命令：${context.lastCommand}
退出码：${context.exitCode}
错误信息：${context.errorOutput}
当前目录：${context.cwd}
操作系统：${context.os}
Shell：${context.shell}`
}

export async function getFixSuggestion(context: FixContext): Promise<FixSuggestion | null> {
  try {
    const [userConfig, appConfig] = await Promise.all([
      loadUserConfig(),
      loadAppConfig(),
    ])

    const url = `${userConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const body = JSON.stringify({
      model: userConfig.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(context) },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), appConfig.timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userConfig.apiKey}`,
        },
        body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const responseBody = await response.text()
      console.error(`[llm] API returned status ${response.status}: ${responseBody}`)
      return null
    }

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }

    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      console.error('[llm] No content in response')
      return null
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('[llm] Failed to parse LLM response as JSON:', content)
      return null
    }

    const cmd = (parsed.command ?? parsed.recommended_command ?? '') as string
    if (!cmd) {
      return null
    }

    const confidence = String(parsed.confidence ?? '') as FixSuggestion['confidence']
    if (confidence && !['high', 'medium', 'low'].includes(confidence)) {
      return { command: cmd }
    }

    return {
      command: cmd,
      ...(confidence ? { confidence } : {}),
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error('[llm] Request timed out')
    } else {
      console.error('[llm] Request failed:', err)
    }
    return null
  }
}
