import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')

export const config = {
  port: Number(process.env.PORT ?? 8787),
  workspacesDir: resolve(process.env.SANGHA_WORKSPACES ?? `${root}/workspaces`),
  pluginsDir: resolve(process.env.SANGHA_PLUGINS ?? `${root}/vendor/plugins`),
  dbPath: resolve(process.env.SANGHA_DB ?? `${root}/data/sangha.db`),
  idleCloseMs: Number(process.env.SANGHA_IDLE_CLOSE_MS ?? 20 * 60_000),
}

/**
 * Sangha runs Claude on the subscription quota only. An API key would silently
 * take precedence over the OAuth login and bill the API, so refuse to start.
 */
export function assertQuotaOnly() {
  if (process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is set: Sangha refuses to start (it would bill the API instead of your plan quota). Unset it.')
    process.exit(1)
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.warn('CLAUDE_CODE_OAUTH_TOKEN not set: relying on the local Claude Code login (fine for `make dev` on your machine, required in Docker).')
  }
}
