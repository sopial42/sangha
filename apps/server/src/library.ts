import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { LibraryMcp } from '@sangha/shared'
import { config } from './config'
import type { Catalog } from './mcp'

type Field = { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }
type Entry = { name: string; description: string; fields: Field[]; config: (v: Record<string, string>) => McpServerConfig }

/** packages/mcp-bitbucket: bundled next to the built server, else (make dev) its sources through tsx. */
function bitbucket(v: Record<string, string>): McpServerConfig {
  const bundled = join(import.meta.dirname, 'mcp-bitbucket.js')
  const sources = join(import.meta.dirname, '../../../packages/mcp-bitbucket/src/index.ts')
  const run = existsSync(bundled)
    ? { command: process.execPath, args: [bundled] }
    : { command: process.execPath, args: [createRequire(import.meta.url).resolve('tsx/cli'), sources] }
  const env: Record<string, string> = { MCP_TRANSPORT: 'stdio', BITBUCKET_API_BASE_URL: v.BITBUCKET_MCP_API_BASE_URL!, BITBUCKET_TOKEN: v.BITBUCKET_MCP_TOKEN! }
  if (v.BITBUCKET_MCP_USER_SLUG) env.BITBUCKET_USER_SLUG = v.BITBUCKET_MCP_USER_SLUG
  return { type: 'stdio', ...run, env }
}

export const LIBRARY: Entry[] = [
  {
    name: 'bitbucket-stdio',
    description: 'Pull requests Bitbucket Data Center (fichiers, diff, commentaires, approbation, branches), avec ton PAT.',
    fields: [
      { key: 'BITBUCKET_MCP_API_BASE_URL', label: 'URL de Bitbucket', placeholder: 'https://stash.ovhcloud.tools' },
      { key: 'BITBUCKET_MCP_TOKEN', label: 'Token (PAT Bitbucket)', secret: true },
      { key: 'BITBUCKET_MCP_USER_SLUG', label: 'Slug utilisateur (pour approuver / demander des changements)', optional: true, placeholder: 'prenom.nom' },
    ],
    config: bitbucket,
  },
]

/** `KEY=value` lines set in place (or appended), the rest of the file untouched. */
export function withEnv(text: string, values: Record<string, string>): string {
  let out = text
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.replace(/[\r\n]/g, '')
    const line = `${key}=${/[\s#"'\\]/.test(value) ? JSON.stringify(value) : value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    out = re.test(out) ? out.replace(re, () => line) : `${out}${out && !out.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  return out
}

/**
 * Sangha's own MCP servers. Switched on in memory, and switched back on at start (`restore`) when Sangha's
 * common switch still has them on; their credentials live in `~/.config/sangha/.env`, read again each time
 * so they survive restarts and a server started without it.
 */
export class McpLibrary {
  private readonly active = new Set<string>()

  constructor(
    private readonly envFile: string,
    private readonly entries: Entry[] = LIBRARY,
  ) {}

  private saved(): Record<string, string> {
    const file = existsSync(this.envFile) ? parseEnv(readFileSync(this.envFile, 'utf8')) : {}
    const out: Record<string, string> = {}
    for (const { key } of this.entries.flatMap((e) => e.fields)) {
      const value = file[key] ?? process.env[key]
      if (value) out[key] = value
    }
    return out
  }

  private entry(name: string): Entry {
    const entry = this.entries.find((e) => e.name === name)
    if (!entry) throw new Error(`${name} n’est pas dans la bibliothèque`)
    return entry
  }

  list(): LibraryMcp[] {
    const saved = this.saved()
    return this.entries.map((e) => ({
      name: e.name,
      description: e.description,
      fields: e.fields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: !!f.secret,
        optional: !!f.optional,
        ...(f.placeholder && { placeholder: f.placeholder }),
        set: !!saved[f.key],
        ...(!f.secret && saved[f.key] && { value: saved[f.key] }),
      })),
      active: this.active.has(e.name),
      missing: e.fields.some((f) => !f.optional && !saved[f.key]),
    }))
  }

  /** Saves the credentials given (blank ones keep what is saved, but clear an optional plain one), then switches it on or off if asked. */
  set(name: string, { active, values }: { active?: boolean; values?: Record<string, string> }): void {
    const entry = this.entry(name)
    const given = Object.fromEntries(
      entry.fields.flatMap((f) => {
        const v = values?.[f.key]?.trim()
        return v || (f.optional && !f.secret && v === '') ? [[f.key, v]] : []
      }),
    )
    if (Object.keys(given).length) {
      const text = existsSync(this.envFile) ? readFileSync(this.envFile, 'utf8') : ''
      mkdirSync(dirname(this.envFile), { recursive: true })
      writeFileSync(this.envFile, withEnv(text, given), { mode: 0o600 })
    }
    if (active === false) this.active.delete(name)
    if (active) {
      const saved = this.saved()
      const missing = entry.fields.filter((f) => !f.optional && !saved[f.key])
      if (missing.length) throw new Error(`il manque : ${missing.map((f) => f.label).join(', ')}`)
      this.active.add(name)
    }
  }

  /**
   * After a restart: switch back on each server Sangha's common switch (`prefs`) still has on — activating
   * one turns that switch on, which outlives the process; otherwise its priests would find it gone while
   * Sangha still shows it on. One whose credentials went missing stays off, silently.
   */
  restore(prefs: Record<string, boolean>): void {
    for (const e of this.entries) {
      if (!prefs[e.name]) continue
      try {
        this.set(e.name, { active: true })
      } catch {
        // its credentials are gone: off, until you give them again
      }
    }
  }

  /** The active entries, as catalog servers a priest can switch on like any other. */
  catalog(): Catalog {
    const saved = this.saved()
    return Object.fromEntries(this.entries.filter((e) => this.active.has(e.name)).map((e) => [e.name, { scope: 'library' as const, config: e.config(saved) }]))
  }
}

export const library = new McpLibrary(config.envFile)
