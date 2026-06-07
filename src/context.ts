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
    const ctx = JSON.parse(raw) as Partial<FixContext>

    if (typeof ctx.lastCommand !== 'string' || ctx.lastCommand.length === 0) return null
    if (typeof ctx.exitCode !== 'number') return null
    if (typeof ctx.errorOutput !== 'string') return null
    if (typeof ctx.cwd !== 'string') return null
    if (ctx.shell !== 'powershell-7' && ctx.shell !== 'zsh') return null
    if (ctx.os !== 'win32' && ctx.os !== 'darwin') return null
    if (typeof ctx.timestamp !== 'string') return null

    return ctx as FixContext
  } catch (err) {
    /* context file not found or invalid, return null */
    return null
  } finally {
    try { await unlink(filePath) } catch (cleanupErr) { /* cleanup-only: unlink temp context file */ }
  }
}
