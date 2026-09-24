import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addWorktree, currentBranch, git, removeWorktree, restoreWorktree } from '../src/git'

describe('restoreWorktree', () => {
  let repo: string
  let root: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sangha-git-'))
    repo = join(root, 'repo')
    await git(root, 'init', '-q', '-b', 'main', repo)
    await git(repo, 'config', 'user.email', 'a@b.c')
    await git(repo, 'config', 'user.name', 'sangha test')
    await git(repo, 'commit', '--allow-empty', '-q', '-m', 'init')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reuses the branch when it survived the archive', async () => {
    const path = join(root, 'w1')
    const baseSha = await addWorktree(repo, path, 'sangha/w1', 'HEAD')
    // Archive keeps the branch alive: it holds a commit (ahead > 0).
    await git(path, 'commit', '--allow-empty', '-q', '-m', 'work')
    await removeWorktree(repo, path, 'sangha/w1', 1)

    await restoreWorktree(repo, path, 'sangha/w1', baseSha)

    expect(await currentBranch(path)).toBe('sangha/w1')
  })

  it('recreates the branch from baseSha when the archive deleted it (no commits)', async () => {
    const path = join(root, 'w2')
    const baseSha = await addWorktree(repo, path, 'sangha/w2', 'HEAD')
    // Archive with no work done deletes the branch (ahead === 0).
    await removeWorktree(repo, path, 'sangha/w2', 0)

    await restoreWorktree(repo, path, 'sangha/w2', baseSha)

    expect(await currentBranch(path)).toBe('sangha/w2')
  })
})
