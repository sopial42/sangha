import { existsSync } from 'node:fs'
import type { ProjectWorktrees, SessionStatus, WorktreeFlag } from '@sangha/shared'
import { git } from './git'
import type { Projects } from './projects'
import type { Sessions } from './session'

/** One block of `git worktree list --porcelain`. */
export type PorcelainWorktree = {
  path: string
  /** Full commit hash checked out (null for a bare entry with nothing checked out). */
  head: string | null
  /** Short branch name (`refs/heads/` stripped), null when detached or bare. */
  branch: string | null
  /** True for the repository's own entry when it only hosts worktrees elsewhere (never checked out itself). */
  bare: boolean
  detached: boolean
  /** Its gitdir file points nowhere: `git worktree prune` would remove it. */
  prunable: boolean
}

/** Parses `git worktree list --porcelain`: blocks separated by a blank line, one `key value` per line. */
export function parseWorktreePorcelain(output: string): PorcelainWorktree[] {
  return output
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const entry: PorcelainWorktree = { path: '', head: null, branch: null, bare: false, detached: false, prunable: false }
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length)
        else if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length)
        else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
        else if (line === 'bare') entry.bare = true
        else if (line === 'detached') entry.detached = true
        else if (line.startsWith('prunable')) entry.prunable = true
      }
      return entry
    })
}

/** Every worktree but the main checkout (always listed first) or its bare container, and a prunable one whose folder is gone. */
function flaggableWorktrees(entries: PorcelainWorktree[]): PorcelainWorktree[] {
  return entries.slice(1).filter((e) => !e.bare && !(e.prunable && !existsSync(e.path)))
}

export type WorktreeStats = { dirty: number; ahead: number | null; lastCommit: number | null }
export type SessionMatch = { id: string; title: string; status: SessionStatus; cwd: string | null }

/** Turns parsed worktrees, their git stats, and the sessions running now into the flags the courtyard shows. */
export function assembleFlags(entries: PorcelainWorktree[], stats: Map<string, WorktreeStats>, sessions: SessionMatch[]): WorktreeFlag[] {
  return flaggableWorktrees(entries).map((e) => {
    const s = stats.get(e.path) ?? { dirty: 0, ahead: null, lastCommit: null }
    const session = sessions.find((s) => s.cwd === e.path)
    return {
      path: e.path,
      branch: e.detached ? null : e.branch,
      head: (e.head ?? '').slice(0, 7),
      dirty: s.dirty,
      ahead: s.ahead,
      lastCommit: s.lastCommit,
      session: session ? { id: session.id, title: session.title, status: session.status } : null,
    }
  })
}

/** Uncommitted files, commits ahead of the main checkout, and the date of the last commit, for one worktree. */
async function gitStats(path: string, mainHead: string | null, head: string | null): Promise<WorktreeStats> {
  const [statusOut, lastCommitOut, aheadOut] = await Promise.all([
    git(path, 'status', '--porcelain').catch(() => ''),
    git(path, 'log', '-1', '--format=%ct').catch(() => null),
    mainHead && head ? git(path, 'rev-list', '--count', `${mainHead}..${head}`).catch(() => null) : Promise.resolve(null),
  ])
  return {
    dirty: statusOut ? statusOut.split('\n').filter(Boolean).length : 0,
    lastCommit: lastCommitOut ? Number(lastCommitOut) * 1000 : null,
    ahead: aheadOut != null && aheadOut !== '' ? Number(aheadOut) : null,
  }
}

/** Every worktree of one repository (its main checkout excepted), decorated with the session working in each. */
export async function projectWorktrees(repoPath: string, sessions: SessionMatch[]): Promise<WorktreeFlag[]> {
  const out = await git(repoPath, 'worktree', 'list', '--porcelain').catch(() => '')
  if (!out) return []
  const entries = parseWorktreePorcelain(out)
  const list = flaggableWorktrees(entries)
  // A bare main entry (a repository that only hosts worktrees, e.g. Marianne) carries no HEAD line of
  // its own in the porcelain output: ask git directly for the commit its HEAD ref points to.
  const mainHead = entries[0]?.head ?? (await git(repoPath, 'rev-parse', 'HEAD').catch(() => null))
  const stats = new Map<string, WorktreeStats>()
  await Promise.all(
    list.map(async (e) => {
      stats.set(e.path, await gitStats(e.path, mainHead, e.head))
    }),
  )
  return assembleFlags(entries, stats, sessions)
}

const CACHE_MS = 10_000
let cache: { at: number; data: ProjectWorktrees[] } | null = null

/**
 * Every project's worktrees, its main checkout excepted, cached briefly so a page of flags does not
 * re-run `git worktree list` (and each worktree's status/log/rev-list) on every request. A project that
 * is not a git repository, or has no worktree beyond its main checkout, comes back with an empty list
 * rather than being left out: the caller always gets one entry per project.
 */
export async function allProjectWorktrees(projects: Projects, sessions: Sessions): Promise<ProjectWorktrees[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const list = await projects.list()
  const sessionMatches: SessionMatch[] = sessions.summaries().map((s) => ({ id: s.id, title: s.title, status: s.status, cwd: s.cwd }))
  const data = await Promise.all(
    list.map(async (p) => {
      // ProjectInfo.isGit tests for a `.git` folder and can miss a bare repository: ask git itself.
      const common = await projects.commonOf(p.path)
      return { project: p.name, worktrees: common ? await projectWorktrees(p.path, sessionMatches) : [] }
    }),
  )
  cache = { at: Date.now(), data }
  return data
}
