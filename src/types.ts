export interface UserConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AppConfig {
  timeoutMs: number
  tempFilePath: string
}

export interface FixContext {
  lastCommand: string
  exitCode: number
  errorOutput: string
  cwd: string
  shell: 'powershell-7' | 'zsh'
  os: 'win32' | 'darwin'
  timestamp: string
}

export interface FixSuggestion {
  command: string
  confidence?: 'high' | 'medium' | 'low'
}
