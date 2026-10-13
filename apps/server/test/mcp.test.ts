import { describe, expect, it } from 'vitest'
import { catalogFrom, enabledExtras, mcpList } from '../src/mcp'
import { Store } from '../src/db'

const json = {
  mcpServers: { atlassian: { type: 'http' as const, url: 'https://mcp.atlassian.com' } },
  projects: {
    '/p/Robia': { mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } } },
    '/p/other': { mcpServers: { linear: { command: 'linear' } } },
  },
}

describe('MCP servers a priest does not load himself', () => {
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

  it('are listed as off until loaded, alongside what the priest runs', () => {
    const list = mcpList(
      [
        { name: 'claude.ai Gmail', status: 'disabled', scope: 'claudeai' },
        { name: 'playwright', status: 'failed', scope: 'dynamic', error: 'boom' },
      ],
      catalogFrom(json, '/p/Robia'),
    )
    expect(list).toEqual([
      { name: 'claude.ai Gmail', status: 'disabled', scope: 'claudeai' },
      { name: 'playwright', status: 'failed', scope: 'local', error: 'boom' },
      { name: 'atlassian', status: 'off', scope: 'user' },
    ])
  })

  it('switches are kept per project', () => {
    const store = new Store(':memory:')
    store.setMcpPref('Robia', 'playwright', true)
    store.setMcpPref('Robia', 'claude.ai Gmail', false)
    store.setMcpPref('Robia', 'playwright', false)
    expect(store.mcpPrefs('Robia')).toEqual({ playwright: false, 'claude.ai Gmail': false })
    expect(store.mcpPrefs('kiat')).toEqual({})
  })
})
