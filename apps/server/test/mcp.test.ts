import { describe, expect, it } from 'vitest'
import { catalogFrom, enabledExtras, mcpList, mcpReady, mcpSettle, pluginServers } from '../src/mcp'
import { Store } from '../src/db'

const json = {
  mcpServers: { atlassian: { type: 'http' as const, url: 'https://mcp.atlassian.com' } },
  projects: {
    '/p/Robia': { mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } } },
    '/p/other': { mcpServers: { linear: { command: 'linear' } } },
  },
}

describe('MCP servers a session does not load itself', () => {
  it('come from your user scope and from the project folder (local scope) only', () => {
    expect(Object.keys(catalogFrom(json, '/p/Robia')).sort()).toEqual(['atlassian', 'playwright'])
    expect(catalogFrom(json, '/p/Robia').playwright?.scope).toBe('local')
    expect(Object.keys(catalogFrom(json, null))).toEqual(['atlassian'])
  })

  it('are added only once switched on', () => {
    const catalog = catalogFrom(json, '/p/Robia')
    expect(enabledExtras(catalog, {})).toEqual({})
    expect(enabledExtras(catalog, { playwright: true, atlassian: false, 'claude.ai Gmail': true })).toEqual({ playwright: json.projects['/p/Robia'].mcpServers.playwright })
  })

  it('are listed as off until loaded, alongside what the session runs', () => {
    const list = mcpList(
      [
        { name: 'claude.ai Gmail', status: 'disabled', scope: 'claudeai' },
        { name: 'playwright', status: 'failed', scope: 'dynamic', error: 'boom' },
      ],
      catalogFrom(json, '/p/Robia'),
      { 'claude.ai Gmail': false, playwright: true },
      { playwright: false },
    )
    expect(list).toEqual([
      { name: 'claude.ai Gmail', status: 'disabled', scope: 'claudeai', global: false },
      { name: 'playwright', status: 'failed', scope: 'local', error: 'boom', global: true, session: false },
      { name: 'atlassian', status: 'off', scope: 'user', global: false },
    ])
    expect(mcpList([{ name: 'codegraph', status: 'connected', scope: 'user' }], {})).toEqual([
      { name: 'codegraph', status: 'connected', scope: 'user', global: true },
    ])
  })

  it('switches are kept for all of Sangha, and a session can override them', () => {
    const store = new Store(':memory:')
    store.setMcpPref('playwright', true)
    store.setMcpPref('claude.ai Gmail', false)
    store.setMcpPref('playwright', false)
    expect(store.mcpPrefs()).toEqual({ playwright: false, 'claude.ai Gmail': false })
    store.setSessionMcpPref('s1', 'playwright', true)
    expect(store.sessionMcpPrefs('s1')).toEqual({ playwright: true })
    expect(store.sessionMcpPrefs('s2')).toEqual({})
    store.setSessionMcpPref('s1', 'playwright', null)
    expect(store.sessionMcpPrefs('s1')).toEqual({})
  })
})

describe('after a sign-in', () => {
  const fast = { waitMs: 3, stepMs: 1 }
  const server = (status: 'connected' | 'pending' | 'needs-auth' | 'failed', error?: string) => ({ name: 'sentry', status, ...(error ? { error } : {}) })

  it('waits while the server is pending, until it connects', async () => {
    const seen = ['pending', 'pending', 'connected'] as const
    let i = 0
    expect(await mcpSettle(async () => server(seen[Math.min(i++, 2)]!), async () => {}, fast)).toBeNull()
  })

  it('reconnects again when the first reconnect fails', async () => {
    let calls = 0
    const reconnect = async () => {
      if (++calls === 1) throw new Error('Request timed out')
    }
    expect(await mcpSettle(async () => server(calls > 1 ? 'connected' : 'needs-auth'), reconnect, fast)).toBeNull()
    expect(calls).toBe(2)
  })

  it('says why it is still not connected', async () => {
    const timeout = async () => {
      throw new Error('Request timed out')
    }
    expect(await mcpSettle(async () => server('needs-auth'), timeout, fast)).toBe('Request timed out')
    expect(await mcpSettle(async () => server('failed', 'HTTP 500'), async () => {}, fast)).toBe('HTTP 500')
    expect(await mcpSettle(async () => server('needs-auth'), async () => {}, fast)).toBe('needs-auth')
  })
})

describe('MCP servers of your plugins', () => {
  const installed = {
    'sentry-mcp@sentry-mcp': [{ scope: 'user', installPath: '/c/sentry' }],
    'miro@miro-ai': [{ scope: 'user', installPath: '/c/miro' }],
    'kit@kit': [{ scope: 'user', installPath: '/c/kit' }],
  }
  const files: Record<string, unknown> = {
    '/c/sentry/.mcp.json': { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } },
    '/c/miro/.mcp.json': { mcpServers: { miro: { type: 'http', url: 'https://mcp.miro.com' } } },
    '/c/kit/.claude-plugin/plugin.json': { name: 'kit', mcpServers: { kit: { command: '${CLAUDE_PLUGIN_ROOT}/bin/kit' } } },
  }

  it('come from enabled plugins only, named as Claude Code names them', () => {
    const catalog = pluginServers({ 'sentry-mcp@sentry-mcp': true, 'miro@miro-ai': false, 'kit@kit': true }, installed, (p) => files[p])
    expect(catalog).toEqual({
      'plugin:sentry-mcp:sentry': { scope: 'user', config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } },
      'plugin:kit:kit': { scope: 'user', config: { command: '/c/kit/bin/kit' } },
    })
  })
})

describe('after a relaunch', () => {
  it('waits for servers still connecting, not forever', async () => {
    let calls = 0
    const status = async () => [{ name: 'sentry', status: ++calls < 3 ? ('pending' as const) : ('connected' as const) }]
    await mcpReady(status, { waitMs: 50, stepMs: 1 })
    expect(calls).toBe(3)
    let stuck = 0
    await mcpReady(async () => (stuck++, [{ name: 'sentry', status: 'pending' as const }]), { waitMs: 5, stepMs: 1 })
    expect(stuck).toBe(5)
  })
})
