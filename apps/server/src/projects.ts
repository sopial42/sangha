import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { AgentOption, ProjectInfo } from '@sangha/shared'
import { config } from './config'
import type { Store } from './db'
import { clone, commonDir, currentBranch, isGitRepo } from './git'
import { readHead } from './files'
import { SANGHA_ROLES } from './roles'

const ROBES = ['#c2703d', '#8e2f2f', '#b8860b', '#4f6d7a', '#6b8e4e', '#7a4f8e', '#a0522d', '#3f7f7a', '#9c6b98', '#5a6f3a']

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects')

/** Claude Code encodes a session's folder into its transcripts directory name. */
export const encodeDir = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

/** Where Claude Code keeps the transcript of a session started in `cwd`. */
export const transcriptPath = (cwd: string, sessionId: string) => join(CLAUDE_PROJECTS, encodeDir(cwd), `${sessionId}.jsonl`)

/** Minimal frontmatter reader for .claude/agents/*.md: `key: value` lines between the first two `---`. */
function frontmatter(file: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))
  if (!m) return {}
  return Object.fromEntries(
    m[1]!
      .split('\n')
      .map((l) => /^([A-Za-z_-]+):\s*(.*)$/.exec(l))
      .filter((x): x is RegExpExecArray => !!x)
      .map((x) => [x[1]!, x[2]!.replace(/^["']|["']$/g, '')]),
  )
}

const pretty = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Agents the project ships in .claude/agents, usable as a priest (main thread). */
function agentsIn(dir: string): AgentOption[] {
  const agentsDir = join(dir, '.claude', 'agents')
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = frontmatter(join(agentsDir, f))
      const id = fm.name || basename(f, '.md')
      return { id, title: pretty(id), description: (fm.description ?? '').slice(0, 300), source: 'project' as const, model: fm.model ?? null }
    })
}

/** Repository root for a git common dir: the parent of `.git`, or the bare repository itself. */
const repoRoot = (common: string) => (basename(common) === '.git' ? dirname(common) : common)

export type Suggestion = { name: string; path: string; lastUsed: number }

/**
 * Projects are the folders of workspaces/ plus any folder registered by path (a repo you already
 * have on this machine). Each is identified by its git common dir, which its worktrees share.
 */
export class Projects {
  private commons = new Map<string, string | null>()

  constructor(private store: Store) {}

  private entries(): { name: string; path: string; local: boolean }[] {
    const ws = existsSync(config.workspacesDir)
      ? readdirSync(config.workspacesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => ({ name: d.name, path: join(config.workspacesDir, d.name), local: false }))
      : []
    const local = this.store
      .localProjects()
      .filter((p) => existsSync(p.path))
      .map((p) => ({ ...p, local: true }))
    return [...ws, ...local].sort((a, b) => a.name.localeCompare(b.name))
  }

  exists = (name: string) => this.entries().some((e) => e.name === name)

  dir(name: string): string {
    const e = this.entries().find((x) => x.name === name)
    if (!e) throw new Error(`unknown project ${name}`)
    return e.path
  }

  color(name: string): string {
    return this.store.projectColor(name, ROBES)
  }

  async list(): Promise<ProjectInfo[]> {
    return Promise.all(
      this.entries().map(async (e) => ({
        name: e.name,
        path: e.path,
        local: e.local,
        color: this.color(e.name),
        isGit: isGitRepo(e.path),
        branch: await currentBranch(e.path),
        agents: [...agentsIn(e.path), ...SANGHA_ROLES],
      })),
    )
  }

  agentsOf(name: string): AgentOption[] {
    return [...agentsIn(this.dir(name)), ...SANGHA_ROLES]
  }

  /** Clone a repository into workspaces/<name>. */
  async add(gitUrl: string, name?: string): Promise<string> {
    const target = name || basename(gitUrl.replace(/\/+$/, '')).replace(/\.git$/, '')
    if (!NAME.test(target)) throw new Error(`nom de projet invalide : ${target}`)
    if (this.exists(target)) throw new Error(`le projet ${target} existe déjà`)
    await clone(gitUrl, join(config.workspacesDir, target))
    return target
  }

  /** Register a folder already on this machine, where it is: nothing is copied or moved. */
  addLocal(path: string, name?: string): string {
    const abs = resolve(path.replace(/^~(?=$|\/)/, homedir()))
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`dossier introuvable : ${abs}`)
    const entries = this.entries()
    if (entries.some((e) => e.path === abs)) throw new Error('ce dossier est déjà un projet')
    let target = name || basename(abs)
    if (!NAME.test(target)) throw new Error(`nom de projet invalide : ${target}`)
    for (let i = 2; entries.some((e) => e.name === target); i++) target = `${name || basename(abs)}-${i}`
    this.store.setIgnored(abs, false)
    this.store.addLocalProject(target, abs.replace(/\/+$/, ''))
    return target
  }

  /** Where a project lives, and whether Sangha owns the folder (a clone in workspaces/). */
  info(name: string): { path: string; local: boolean } {
    const e = this.entries().find((x) => x.name === name)
    if (!e) throw new Error(`projet inconnu : ${name}`)
    return { path: e.path, local: e.local }
  }

  /**
   * Take a project out of the monastery. A folder of this machine is only unregistered, never touched;
   * a clone Sangha made in workspaces/ is deleted.
   */
  remove(name: string) {
    const { path, local } = this.info(name)
    // Remembered, so the observer does not bring it back the next time an agent runs there.
    this.store.setIgnored(path, true)
    if (local) this.store.removeLocalProject(name)
    else rmSync(path, { recursive: true, force: true })
    this.commons.delete(path)
  }

  /** Git common dir of a folder, cached (a worktree resolves to its main repository). */
  async commonOf(path: string): Promise<string | null> {
    if (!this.commons.has(path)) this.commons.set(path, existsSync(path) ? await commonDir(path) : null)
    return this.commons.get(path)!
  }

  /**
   * The project a folder belongs to: the git repository that contains it (a worktree counts for its main
   * repository), or a project folder that contains it. With `autoAdd`, an unknown repository (or a
   * non-git folder) becomes a project, unless you took it out before. Scratch folders never do.
   */
  async resolve(cwd: string, autoAdd: boolean): Promise<{ name: string; added: boolean } | null> {
    if (!existsSync(cwd)) return null
    const common = await this.commonOf(cwd)
    const entries = this.entries()
    if (common) {
      for (const e of entries) if ((await this.commonOf(e.path)) === common) return { name: e.name, added: false }
    }
    const inside = entries.filter((e) => cwd === e.path || cwd.startsWith(e.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
    if (inside) return { name: inside.name, added: false }
    if (!autoAdd) return null
    const root = common ? repoRoot(common) : cwd
    if (!existsSync(root) || isScratch(root) || this.store.ignoredProjects().has(root) || root === homedir()) return null
    try {
      return { name: this.addLocal(root), added: true }
    } catch {
      return null
    }
  }

  /** Map git common dir -> project name, for attributing outside Claude sessions to projects. */
  async byCommonDir(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const e of this.entries()) {
      const c = await this.commonOf(e.path)
      if (c) map.set(c, e.name)
    }
    return map
  }

  /**
   * Git repositories where Claude Code ran recently, found from its transcripts
   * (~/.claude/projects/<dir>/<session>.jsonl lines carry the session's cwd).
   */
  async suggestions(days = 14): Promise<Suggestion[]> {
    if (!existsSync(CLAUDE_PROJECTS)) return []
    const since = Date.now() - days * 86_400_000
    const known = new Set<string>()
    for (const e of this.entries()) {
      const c = await this.commonOf(e.path)
      if (c) known.add(c)
    }
    const found = new Map<string, Suggestion>()
    for (const d of readdirSync(CLAUDE_PROJECTS)) {
      const dir = join(CLAUDE_PROJECTS, d)
      const newest = newestJsonl(dir)
      if (!newest || newest.mtime < since) continue
      const cwd = firstCwd(newest.path)
      if (!cwd || cwd.startsWith(config.workspacesDir)) continue
      const common = await this.commonOf(cwd)
      if (!common || known.has(common)) continue
      const root = repoRoot(common)
      const prev = found.get(root)
      if (!prev || prev.lastUsed < newest.mtime) found.set(root, { name: basename(root), path: root, lastUsed: newest.mtime })
    }
    return [...found.values()].filter((s) => existsSync(s.path)).sort((a, b) => b.lastUsed - a.lastUsed)
  }
}

/** Temporary and tool folders: sessions briefly cd there, they are not projects. */
function isScratch(path: string): boolean {
  const scratch = [tmpdir(), '/tmp', '/private/tmp/claude-', '/private/var/folders', join(homedir(), '.claude'), config.workspacesDir + '/.worktrees']
  return scratch.some((s) => path === s || path.startsWith(s.endsWith('-') ? s : s + '/'))
}

function newestJsonl(dir: string): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const mtime = statSync(join(dir, f)).mtimeMs
      if (!best || mtime > best.mtime) best = { path: join(dir, f), mtime }
    }
  } catch {
    return null
  }
  return best
}

/** The cwd recorded in the first lines of a transcript. */
export function firstCwd(file: string): string | null {
  try {
    const head = readHead(file, 64 * 1024)
    for (const line of head.split('\n')) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line)
      if (m) return JSON.parse(`"${m[1]}"`) as string
    }
  } catch {
    // unreadable transcript: ignore
  }
  return null
}
