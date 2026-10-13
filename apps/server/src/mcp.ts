import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig, McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import type { McpServer } from '@sangha/shared'

/**
 * MCP servers of your own Claude config that a priest does not load by himself: he reads only the
 * project's settings, so your user-scope servers and the ones you added for this project (local scope,
 * keyed by its folder, which a worktree does not share) stay out unless you switch them on.
 */
export type Catalog = Record<string, { scope: 'user' | 'local'; config: McpServerConfig }>

type ClaudeJson = { mcpServers?: Record<string, McpServerConfig>; projects?: Record<string, { mcpServers?: Record<string, McpServerConfig> }> }

export function catalogFrom(json: ClaudeJson, projectDir: string | null): Catalog {
  const out: Catalog = {}
  for (const [name, config] of Object.entries(json.mcpServers ?? {})) out[name] = { scope: 'user', config }
  const local = projectDir ? json.projects?.[projectDir]?.mcpServers : undefined
  for (const [name, config] of Object.entries(local ?? {})) out[name] = { scope: 'local', config }
  return out
}

export function readCatalog(projectDir: string | null): Catalog {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? homedir()
  try {
    return catalogFrom(JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8')), projectDir)
  } catch {
    return {}
  }
}

/** The catalog servers you switched on for this project, as the SDK's `mcpServers` option. */
export function enabledExtras(catalog: Catalog, prefs: Record<string, boolean>): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(catalog).filter(([name]) => prefs[name]).map(([name, s]) => [name, s.config]))
}

/** What the priest runs, plus the catalog servers he does not load, shown as off. */
export function mcpList(statuses: McpServerStatus[], catalog: Catalog): McpServer[] {
  const list: McpServer[] = statuses.map((s) => ({
    name: s.name,
    status: s.status,
    scope: s.scope === 'dynamic' ? (catalog[s.name]?.scope ?? 'dynamic') : (s.scope ?? 'project'),
    ...(s.error ? { error: s.error } : {}),
  }))
  const loaded = new Set(list.map((s) => s.name))
  for (const [name, s] of Object.entries(catalog)) if (!loaded.has(name)) list.push({ name, status: 'off', scope: s.scope })
  return list
}
