import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig, McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import type { McpServer } from '@sangha/shared'

/**
 * MCP servers of your own Claude config that a priest does not load by himself: he reads only the
 * project's settings, so your user-scope servers (your enabled plugins' included) and the ones you added for this project (local scope,
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

type Installed = Record<string, { scope?: string; installPath?: string }[]>

/**
 * MCP servers of the plugins you enabled for your user (`enabledPlugins` of your settings), named the way
 * Claude Code names them (`plugin:<plugin>:<server>`), so a sign-in made in a terminal is the same one here.
 * A plugin declares them in its `.mcp.json`, flat or under `mcpServers`, or in its manifest.
 */
export function pluginServers(enabled: Record<string, boolean>, installed: Installed, read: (path: string) => unknown): Catalog {
  const out: Catalog = {}
  for (const [id, on] of Object.entries(enabled)) {
    const install = on ? installed[id]?.find((i) => i.scope === 'user' && i.installPath) : undefined
    if (!install) continue
    const root = install.installPath!
    const plugin = id.split('@')[0]!
    const manifest = read(join(root, '.claude-plugin', 'plugin.json')) as { mcpServers?: unknown } | undefined
    const file = read(join(root, '.mcp.json')) as { mcpServers?: unknown } | undefined
    const declared = { ...asServers(file?.mcpServers ?? file), ...asServers(manifest?.mcpServers) }
    for (const [name, config] of Object.entries(declared)) {
      const resolved = JSON.parse(JSON.stringify(config).replaceAll('${CLAUDE_PLUGIN_ROOT}', root)) as McpServerConfig
      out[`plugin:${plugin}:${name}`] = { scope: 'user', config: resolved }
    }
  }
  return out
}

const asServers = (v: unknown): Record<string, McpServerConfig> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, c]) => c && typeof c === 'object' && ('url' in c || 'command' in c)))
    : {}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function readCatalog(projectDir: string | null): Catalog {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? homedir()
  const claude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const settings = readJson(join(claude, 'settings.json')) as { enabledPlugins?: Record<string, boolean> } | undefined
  const installed = readJson(join(claude, 'plugins', 'installed_plugins.json')) as { plugins?: Installed } | undefined
  const plugins = pluginServers(settings?.enabledPlugins ?? {}, installed?.plugins ?? {}, readJson)
  const json = readJson(join(dir, '.claude.json')) as ClaudeJson | undefined
  return { ...plugins, ...(json ? catalogFrom(json, projectDir) : {}) }
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

/**
 * After a sign-in: reconnect the server until it is connected, up to `tries` reconnects, waiting while it is
 * pending. Resolves to null once connected, else to why it is not (the last reconnect error or its status).
 */
export async function mcpSettle(
  status: () => Promise<McpServerStatus | undefined>,
  reconnect: () => Promise<void>,
  { tries = 2, waitMs = 15_000, stepMs = 1_000 } = {},
): Promise<string | null> {
  let why = 'introuvable'
  for (let i = 0; i < tries; i++) {
    why = await reconnect().then(
      () => '',
      (e) => (e instanceof Error ? e.message : String(e)),
    )
    for (let waited = 0; ; waited += stepMs) {
      const s = await status().catch(() => undefined)
      if (s?.status === 'connected') return null
      if (s?.status !== 'pending' || waited >= waitMs) {
        why = why || s?.error || (s ? s.status : 'introuvable')
        break
      }
      await new Promise((r) => setTimeout(r, stepMs))
    }
  }
  return why.slice(0, 200)
}

/**
 * Sign in to an MCP server the way `/mcp` does in a terminal: `claude mcp login` opens your browser and
 * waits for the OAuth callback on localhost (so only where Sangha runs on your machine). It wants a
 * terminal, hence `script`, fed by a pipe that stays open (Node's own stdin is a socket `script` rejects,
 * and an EOF would make it stop waiting). It refuses project servers not approved in that folder, hence
 * `--settings`. Credentials land in Claude Code's store, shared by every folder declaring the same server.
 */
export function mcpLogin(cwd: string, name: string, timeoutMs = 4 * 60_000): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, MCP_NAME: name, MCP_SETTINGS: JSON.stringify({ enabledMcpjsonServers: [name] }) }
  delete env.ANTHROPIC_API_KEY // never bill the API
  const cmd = 'script -q /dev/null claude --settings "$MCP_SETTINGS" mcp login "$MCP_NAME" < <(sleep 3600)'
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const stop = () => {
      try {
        process.kill(-child.pid!) // the whole group, the feeding `sleep` included
      } catch {}
    }
    const timer = setTimeout(stop, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      stop()
      const text = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)?|\r|\^D\x08\x08/g, '')
      if (/Authenticated with/.test(text)) return resolve()
      const why = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('[mcp-sdk]') && !l.startsWith('Starting authentication'))
      reject(new Error(/Waiting for authorization/.test(text) ? 'pas d’autorisation reçue à temps' : (why?.slice(0, 200) ?? 'échec de la connexion')))
    })
  })
}
