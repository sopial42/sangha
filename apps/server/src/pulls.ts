import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PullRequest } from '@sangha/shared'
import { currentBranch } from './git'

const TRUNKS = new Set(['main', 'master', 'develop', 'dev'])

const exec = promisify(execFile)

/** At most every this long, a folder gets a fresh `gh pr list` call. */
const REFRESH_EVERY_MS = 2 * 60_000

/** Raw shape of one item from `gh pr list --json number,url,title,state,isDraft`. */
export type GhPullRequest = {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
}

/**
 * Picks the most relevant pull request for a branch: an open one first (draft if it is one), else the
 * most recent merged or closed one (the order `gh pr list` returns, newest first). Pure mapping, no I/O.
 */
export function mapPullRequest(items: GhPullRequest[], branch: string): PullRequest | null {
  const pick = items.find((p) => p.state === 'OPEN') ?? items[0]
  if (!pick) return null
  const state: PullRequest['state'] = pick.state === 'OPEN' ? (pick.isDraft ? 'draft' : 'open') : pick.state === 'MERGED' ? 'merged' : 'closed'
  return { number: pick.number, url: pick.url, title: pick.title, state, branch }
}

let warnedMissingGh = false

/**
 * Looks up the pull request of the branch checked out in `folder`, via `gh`. Quiet on any failure (`gh`
 * missing, unauthenticated, no such repository on GitHub…): never throws, logs the first failure only.
 */
export async function lookupPullRequest(folder: string): Promise<PullRequest | null> {
  try {
    const branch = await currentBranch(folder)
    // Detached, or a trunk: a PR is opened from a work branch, never from these.
    if (!branch || branch === 'HEAD' || TRUNKS.has(branch)) return null
    const { stdout } = await exec('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,title,state,isDraft', '--limit', '5'], {
      cwd: folder,
      timeout: 15_000,
    })
    const items = JSON.parse(stdout) as GhPullRequest[]
    return mapPullRequest(items, branch)
  } catch (err) {
    if (!warnedMissingGh) {
      warnedMissingGh = true
      console.error('[pulls] gh pr list failed (further failures kept quiet):', err instanceof Error ? err.message : err)
    }
    return null
  }
}

/**
 * Per-folder cache of pull requests, read synchronously by summaries. Refreshed in the background, one
 * `gh` call at a time, at most every two minutes per folder — mirrors the "doing" refresher in session.ts.
 */
export class PullRequests {
  private cache = new Map<string, PullRequest | null>()
  private checkedAt = new Map<string, number>()
  private queue: string[] = []
  private queued = new Set<string>()
  private draining: Promise<void> | null = null

  constructor(
    /** Called when a folder's cached pull request changed, so its sessions can be re-broadcast. */
    private onChange: (cwd: string) => void,
    private lookup: (cwd: string) => Promise<PullRequest | null> = lookupPullRequest,
  ) {}

  /** The cached pull request for a folder, or null when there is none (or none looked up yet). */
  of(cwd: string): PullRequest | null {
    return this.cache.get(cwd) ?? null
  }

  /** Queues every folder not checked in the last two minutes. */
  tick(cwds: Iterable<string>) {
    const now = Date.now()
    for (const cwd of cwds) {
      const last = this.checkedAt.get(cwd) ?? 0
      if (now - last >= REFRESH_EVERY_MS) this.enqueue(cwd)
    }
    void this.drain()
  }

  /**
   * A session likely just opened a pull request (it stopped working, or a tool mentioned `gh pr`):
   * check its folder again right away, skipping the usual two-minute spacing. Callers that want the
   * "a few seconds after" delay from the spec schedule this call themselves (see session.ts).
   */
  soon(cwd: string) {
    this.checkedAt.delete(cwd)
    this.enqueue(cwd)
    void this.drain()
  }

  /** Resolves once every queued folder has been checked (for tests: awaits the current drain to finish). */
  async drained() {
    await this.draining
  }

  private enqueue(cwd: string) {
    if (this.queued.has(cwd)) return
    this.queued.add(cwd)
    this.queue.push(cwd)
  }

  private drain(): Promise<void> {
    if (!this.draining) this.draining = this.runQueue().finally(() => (this.draining = null))
    return this.draining
  }

  private async runQueue() {
    for (let cwd = this.queue.shift(); cwd; cwd = this.queue.shift()) {
      this.queued.delete(cwd)
      this.checkedAt.set(cwd, Date.now())
      const pr = await this.lookup(cwd).catch(() => null)
      const prev = this.cache.get(cwd)
      this.cache.set(cwd, pr)
      if (JSON.stringify(prev) !== JSON.stringify(pr)) this.onChange(cwd)
    }
  }
}
