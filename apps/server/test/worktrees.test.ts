import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/git'
import { assembleFlags, parseWorktreePorcelain, projectWorktrees, type PorcelainWorktree } from '../src/worktrees'

describe('parseWorktreePorcelain', () => {
  it('parses the main checkout and a branch worktree', () => {
    const out = ['worktree /repo', 'HEAD aaaa000000000000000000000000000000000a', 'branch refs/heads/main', '', 'worktree /repo-w1', 'HEAD bbbb000000000000000000000000000000000b', 'branch refs/heads/feature', ''].join(
      '\n',
    )
    expect(parseWorktreePorcelain(out)).toEqual([
      { path: '/repo', head: 'aaaa000000000000000000000000000000000a', branch: 'main', bare: false, detached: false, prunable: false },
      { path: '/repo-w1', head: 'bbbb000000000000000000000000000000000b', branch: 'feature', bare: false, detached: false, prunable: false },
    ])
  })

  it('flags a detached worktree with no branch', () => {
    const out = ['worktree /repo-w2', 'HEAD cccc000000000000000000000000000000000c', 'detached', ''].join('\n')
    expect(parseWorktreePorcelain(out)[0]).toMatchObject({ branch: null, detached: true })
  })

  it('flags a bare main entry (a repository used only to host worktrees elsewhere)', () => {
    const out = ['worktree /bare', 'bare', ''].join('\n')
    expect(parseWorktreePorcelain(out)[0]).toMatchObject({ path: '/bare', bare: true, head: null, branch: null })
  })

  it('flags a prunable worktree (its gitdir points nowhere)', () => {
    const out = ['worktree /gone', 'HEAD dddd000000000000000000000000000000000d', 'branch refs/heads/x', 'prunable gitdir file points to non-existent location', ''].join('\n')
    expect(parseWorktreePorcelain(out)[0]).toMatchObject({ path: '/gone', prunable: true })
  })
})

describe('assembleFlags', () => {
  const entries: PorcelainWorktree[] = [
    { path: '/repo', head: 'a'.repeat(40), branch: 'main', bare: false, detached: false, prunable: false },
    { path: '/repo-w1', head: 'b'.repeat(40), branch: 'feature', bare: false, detached: false, prunable: false },
    { path: '/repo-w2', head: 'c'.repeat(40), branch: null, bare: false, detached: true, prunable: false },
  ]

  it('drops the main checkout, keeping the rest with their stats', () => {
    const stats = new Map([
      ['/repo-w1', { dirty: 2, ahead: 3, lastCommit: 1000 }],
      ['/repo-w2', { dirty: 0, ahead: null, lastCommit: null }],
    ])
    expect(assembleFlags(entries, stats, [])).toEqual([
      { path: '/repo-w1', branch: 'feature', head: 'bbbbbbb', dirty: 2, ahead: 3, lastCommit: 1000, session: null },
      { path: '/repo-w2', branch: null, head: 'ccccccc', dirty: 0, ahead: null, lastCommit: null, session: null },
    ])
  })

  it('attaches the session working in a worktree, by matching cwd', () => {
    const stats = new Map([['/repo-w1', { dirty: 0, ahead: 0, lastCommit: null }]])
    const flags = assembleFlags(entries.slice(0, 2), stats, [{ id: 's1', title: 'Titre', status: 'working', cwd: '/repo-w1' }])
    expect(flags[0]!.session).toEqual({ id: 's1', title: 'Titre', status: 'working' })
  })
})

describe('projectWorktrees (integration)', () => {
  let root: string
  let repo: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sangha-worktrees-'))
    repo = join(root, 'repo')
    await git(root, 'init', '-q', '-b', 'main', repo)
    await git(repo, 'config', 'user.email', 'a@b.c')
    await git(repo, 'config', 'user.name', 'sangha test')
    await git(repo, 'commit', '--allow-empty', '-q', '-m', 'init')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists worktrees other than the main checkout, with dirty and ahead counts', async () => {
    await git(repo, 'worktree', 'add', '-b', 'sangha/clean', join(root, 'w-clean'))
    await git(repo, 'worktree', 'add', '-b', 'sangha/dirty', join(root, 'w-dirty'))
    // git worktree list reports the real path (macOS resolves /tmp through a symlink): match on that.
    const clean = realpathSync(join(root, 'w-clean'))
    const dirty = realpathSync(join(root, 'w-dirty'))
    await git(dirty, 'commit', '--allow-empty', '-q', '-m', 'one more')
    writeFileSync(join(dirty, 'scratch.txt'), 'wip')

    const flags = await projectWorktrees(repo, [{ id: 's1', title: 'En cours', status: 'working', cwd: dirty }])
    const byPath = new Map(flags.map((f) => [f.path, f]))

    expect(flags).toHaveLength(2)
    expect(byPath.get(clean)).toMatchObject({ branch: 'sangha/clean', dirty: 0, ahead: 0, session: null })
    expect(byPath.get(dirty)).toMatchObject({ branch: 'sangha/dirty', dirty: 1, ahead: 1, session: { id: 's1', title: 'En cours', status: 'working' } })
    expect(byPath.get(dirty)!.head).toHaveLength(7)
    expect(byPath.get(dirty)!.lastCommit).toBeGreaterThan(0)
  })

  it('returns no worktrees for a repository that has none beyond its main checkout', async () => {
    expect(await projectWorktrees(repo, [])).toEqual([])
  })
})

describe('projectWorktrees on a bare repository (e.g. Marianne, a repo used only to host worktrees)', () => {
  let root: string
  let bare: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sangha-bare-'))
    const src = join(root, 'src')
    await git(root, 'init', '-q', '-b', 'main', src)
    await git(src, 'config', 'user.email', 'a@b.c')
    await git(src, 'config', 'user.name', 'sangha test')
    await git(src, 'commit', '--allow-empty', '-q', '-m', 'init')
    bare = join(root, 'bare.git')
    await git(root, 'clone', '--bare', '-q', src, bare)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists worktrees, computing ahead from the bare repository HEAD (absent from its own porcelain entry)', async () => {
    await git(bare, 'worktree', 'add', '-b', 'feat', join(root, 'w1'))
    const w1 = realpathSync(join(root, 'w1'))
    await git(w1, 'commit', '--allow-empty', '-q', '-m', 'one more')

    const flags = await projectWorktrees(bare, [])

    expect(flags).toEqual([{ path: w1, branch: 'feat', head: expect.any(String), dirty: 0, ahead: 1, lastCommit: expect.any(Number), session: null }])
  })
})
