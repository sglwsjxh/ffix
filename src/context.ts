import type { FixContext } from './types.js'
import { readFile, unlink } from 'node:fs/promises'
import { appConfig } from './config.js'

function resolveTempPath(template: string): string {
  const tempDir = process.env.TEMP ?? process.env.TMPDIR ?? ''
  return template.replace(/%TEMP%/g, tempDir)
}

export async function readContext(): Promise<FixContext | null> {
  const filePath = resolveTempPath(appConfig.tempFilePath)
  return readContextFromPath(filePath)
}

export async function readContextFromPath(filePath: string): Promise<FixContext | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const ctx: FixContext = JSON.parse(raw)

    if (typeof ctx.lastCommand !== 'string' || ctx.lastCommand.length === 0) return null
    if (typeof ctx.exitCode !== 'number') return null

    return ctx
  } catch {
    return null
  } finally {
    try { await unlink(filePath) } catch { /* cleanup-only, swallow unlink error */ }
  }
}
