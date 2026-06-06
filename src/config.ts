import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

import type { UserConfig, AppConfig } from './types.js'

const CONFIG_DIR = join(homedir(), '.ffix')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

const DEFAULT_USER_CONFIG: UserConfig = {
  baseUrl: '',
  apiKey: '',
  model: '',
}

const DEFAULT_APP_CONFIG: AppConfig = {
  stderrTailLines: 20,
  timeoutMs: 15_000,
  tempFilePath: '%TEMP%\\fuck_ctx.json',
}

export async function ensureConfig(): Promise<'ready' | 'created'> {
  try {
    await readFile(CONFIG_PATH, 'utf-8')
    return 'ready'
  } catch {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_USER_CONFIG, null, 4), 'utf-8')
    console.log(`首次使用，请配置 API 信息：${CONFIG_PATH}`)
    return 'created'
  }
}

export async function loadUserConfig(): Promise<UserConfig> {
  const raw = await readFile(CONFIG_PATH, 'utf-8')
  const config: UserConfig = JSON.parse(raw)

  if (!config.apiKey) {
    throw new Error(`请在 ${CONFIG_PATH} 中配置 apiKey`)
  }

  return {
    baseUrl: config.baseUrl || DEFAULT_USER_CONFIG.baseUrl,
    apiKey: config.apiKey,
    model: config.model || DEFAULT_USER_CONFIG.model,
  }
}

export async function loadAppConfig(): Promise<AppConfig> {
  return DEFAULT_APP_CONFIG
}
