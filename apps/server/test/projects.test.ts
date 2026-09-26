import { mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/db'
import { addWorktree, currentBranch, git } from '../src/git'

describe('a local project whose folder was renamed', () => {
  let root: string
  let repo: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sangha-projects-'))
    vi.stubEnv('SANGHA_WORKSPACES', join(root, 'workspaces'))
    vi.resetModules()
    repo = join(root, 'Robia')
    await git(root, 'init', '-q', '-b', 'main', repo)
    await git(repo, 'config', 'user.email', 'a@b.c')
    await git(repo, 'config', 'user.name', 'sangha test')
    await git(repo, 'commit', '--allow-empty', '-q', '-m', 'init')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('is reported missing instead of vanishing, and can be pointed at its new folder', async () => {
    const { Projects } = await import('../src/projects')
    const projects = new Projects(new Store(':memory:'))
    expect(projects.addLocal(repo)).toBe('Robia')
    const wt = join(root, 'workspaces', '.worktrees', 'Robia', 'lead-1')
    await addWorktree(repo, wt, 'sangha/lead-1', 'HEAD')

    const moved = join(root, 'Marianne')
    renameSync(repo, moved)

    expect((await projects.list()).map((p) => p.name)).not.toContain('Robia')
    expect(projects.missing()).toEqual([{ name: 'Robia', path: repo }])

    await projects.relocate('Robia', moved)

    expect(projects.missing()).toEqual([])
    expect(projects.dir('Robia')).toBe(moved)
    // The priests' worktrees follow the repository.
    expect(await currentBranch(wt)).toBe('sangha/lead-1')
    expect(await projects.resolve(wt, false)).toEqual({ name: 'Robia', added: false })
  })

  it('refuses to point a project at a folder that is not there', async () => {
    const { Projects } = await import('../src/projects')
    const projects = new Projects(new Store(':memory:'))
    projects.addLocal(repo)
    await expect(projects.relocate('Robia', join(root, 'nowhere'))).rejects.toThrow(/introuvable/)
  })
})
