import { describe, it, expect } from 'vitest'

import { generateProfileScript } from '../shell.js'

describe('generateProfileScript()', () => {
  it('matches $Error[0] only for the current command via InvocationInfo.Line', () => {
    const script = generateProfileScript()
    expect(script).toContain('$Error[0].InvocationInfo.Line -eq $lastCmd')
  })

  it('uses PowerShell host instance id to isolate temp context files per session', () => {
    const script = generateProfileScript()
    const isolatedPath = '$env:TEMP\\fuck_ctx_$($Host.InstanceId).json'

    expect(script).toContain('$Host.InstanceId')
    expect(script).toContain(`Out-File -FilePath "${isolatedPath}"`)
    expect(script).toContain(`$ctxPath = "${isolatedPath}"`)
  })
})
