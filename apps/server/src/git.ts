import { execFile } from 'node:child_process'
import { existsSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60_000 })
    return stdout.trim()
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    throw new Error(`git ${args[0]}: ${(e.stderr || e.message).trim()}`)
  }
}

export const isGitRepo = (dir: string) => existsSync(join(dir, '.git'))

/** Branch checked out in a folder (a repository, one of its worktrees, or a subfolder of them). */
export async function currentBranch(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null
  return git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => null)
}

/** Absolute git common dir: the same for a repository and all its worktrees. */
export async function commonDir(dir: string): Promise<string | null> {
  return git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir').catch(() => null)
}

export async function branches(dir: string): Promise<string[]> {
  if (!isGitRepo(dir)) return []
  const out = await git(dir, 'branch', '--format=%(refname:short)')
  return out.split('\n').filter(Boolean)
}

/** Isolated checkout for one session, on its own branch, so parallel priests never collide. */
export async function addWorktree(repo: string, path: string, branch: string, baseRef: string): Promise<string> {
  const base = await git(repo, 'rev-parse', '--verify', `${baseRef}^{commit}`)
  await git(repo, 'worktree', 'add', '-b', branch, path, base)
  return base
}

export type WorktreeState = { dirty: number; ahead: number }

export async function worktreeState(path: string, baseSha: string): Promise<WorktreeState> {
  if (!existsSync(path)) return { dirty: 0, ahead: 0 }
  const status = await git(path, 'status', '--porcelain')
  const ahead = await git(path, 'rev-list', '--count', `${baseSha}..HEAD`)
  return { dirty: status ? status.split('\n').length : 0, ahead: Number(ahead) }
}

/** Remove the checkout. The branch is kept whenever it holds commits, so no work is ever lost. */
export async function removeWorktree(repo: string, path: string, branch: string, ahead: number) {
  if (existsSync(path)) await git(repo, 'worktree', 'remove', '--force', path)
  else await git(repo, 'worktree', 'prune')
  // workspaces/.worktrees/<project>/ goes too once its last worktree is gone.
  try {
    rmdirSync(dirname(path))
  } catch {
    // not empty: other priests of this project still work there
  }
  if (ahead === 0) await git(repo, 'branch', '-D', branch).catch(() => undefined)
}

export async function clone(url: string, into: string) {
  await git(join(into, '..'), 'clone', url, into)
}

/** Bring back a worktree an archive removed. The branch survives when it held work: reuse it. Otherwise
 * (removeWorktree deletes branches with no commits) recreate it from the base commit the priest started on. */
export async function restoreWorktree(repo: string, path: string, branch: string, baseSha: string) {
  if ((await branches(repo)).includes(branch)) await git(repo, 'worktree', 'add', path, branch)
  else await git(repo, 'worktree', 'add', '-b', branch, path, baseSha)
}
