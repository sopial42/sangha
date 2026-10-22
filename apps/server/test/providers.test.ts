import { describe, expect, it } from 'vitest'
import { providerEnv, shellExports } from '@sangha/shared'

const ovh = { baseUrl: 'https://internal-ai.ovhcloud.tools', apiKey: 'axel.dhondt@corp.ovh.com', authToken: '', timeoutMs: 3_000_000 }

describe('providerEnv', () => {
  it('points every alias and subagent at the one model', () => {
    const env = providerEnv(ovh, 'galere/DeepSeek-V4.1-Flash')
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'])
      expect(env[k]).toBe('galere/DeepSeek-V4.1-Flash')
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: ovh.baseUrl, ANTHROPIC_API_KEY: ovh.apiKey, ANTHROPIC_AUTH_TOKEN: 'not-needed', API_TIMEOUT_MS: '3000000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  })
})

describe('shellExports', () => {
  it('writes export lines, escaping what a double-quoted shell string would expand', () => {
    expect(shellExports({ A: 'x', B: 'a"b$c`d\\e' })).toBe('export A="x"\nexport B="a\\"b\\$c\\`d\\\\e"')
  })
})
