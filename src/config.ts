import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UserConfig, AppConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

const DEFAULT_APP_CONFIG: AppConfig = {
  stderrTailLines: 20,
  timeoutMs: 15_000,
  tempFilePath: '%TEMP%\\fuck_ctx.json',
}

export async function loadUserConfig(): Promise<UserConfig> {
  const configPath = resolve(PROJECT_ROOT, 'config', 'user.json')
  const raw = await readFile(configPath, 'utf-8')
  const config: UserConfig = JSON.parse(raw)

  if (!config.apiKey) {
    throw new Error('apiKey is missing in config/user.json - please configure it first')
  }

  return config
}

export async function loadAppConfig(): Promise<AppConfig> {
  const configPath = resolve(PROJECT_ROOT, 'config', 'config.json')

  try {
    const raw = await readFile(configPath, 'utf-8')
    const config: Partial<AppConfig> = JSON.parse(raw)
    return { ...DEFAULT_APP_CONFIG, ...config }
  } catch {
    return DEFAULT_APP_CONFIG
  }
}
