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
  tempFilePath: '%TEMP%\\fuck_ctx_<session>.json',
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
  let parsed: Partial<UserConfig>

  try {
    parsed = JSON.parse(raw) as Partial<UserConfig>
  } catch {
    console.error(`配置文件 ${CONFIG_PATH} 格式错误，请检查 JSON 语法后重新运行`)
    process.exit(1)
    return DEFAULT_USER_CONFIG
  }

  const config: UserConfig = {
    baseUrl: parsed.baseUrl || DEFAULT_USER_CONFIG.baseUrl,
    apiKey: parsed.apiKey || DEFAULT_USER_CONFIG.apiKey,
    model: parsed.model || DEFAULT_USER_CONFIG.model,
  }

  const validationErrors = validateUserConfig(config)
  if (validationErrors.length > 0) {
    for (const error of validationErrors) console.error(error)
    process.exit(1)
    return config
  }

  return config
}

export function validateUserConfig(config: Partial<UserConfig>): string[] {
  const errors: string[] = []

  if (typeof config.baseUrl !== 'string' || config.baseUrl.trim() === '') {
    errors.push('baseUrl 配置无效：请填写非空的绝对 URL，例如 https://api.example.com')
  } else {
    try {
      new URL(config.baseUrl)
    } catch {
      errors.push('baseUrl 配置无效：必须是可解析的绝对 URL，例如 https://api.example.com')
    }
  }

  if (typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
    errors.push('apiKey 配置无效：请填写非空字符串')
  }

  if (typeof config.model !== 'string' || config.model.trim() === '') {
    errors.push('model 配置无效：请填写非空字符串')
  }

  return errors
}

export async function loadAppConfig(): Promise<AppConfig> {
  return DEFAULT_APP_CONFIG
}
