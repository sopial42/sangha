import { beforeEach, describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildWorktreeCommentsPrompt, parseWorktreeComments, worktreeComments, type WorktreeCommentInput } from '../src/recap'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

beforeEach(() => {
  vi.mocked(query).mockClear()
})

const entry = (over: Partial<WorktreeCommentInput> = {}): WorktreeCommentInput => ({
  path: '/w/.worktrees/p/old',
  name: 'p/old',
  branch: 'sangha/lead-1',
  commits: ['ajoute les tests', 'corrige le panier'],
  dirty: 0,
  unpushed: 0,
  owner: 'RIB ET MAIL',
  ...over,
})

describe('buildWorktreeCommentsPrompt', () => {
  it('writes one line per worktree with its path, branch, commits, safety counts and owner', () => {
    const prompt = buildWorktreeCommentsPrompt([entry()])
    expect(prompt).toContain('path=/w/.worktrees/p/old')
    expect(prompt).toContain('branche=sangha/lead-1')
    expect(prompt).toContain('ajoute les tests | corrige le panier')
    expect(prompt).toContain('modifs=0')
    expect(prompt).toContain('non_poussés=0')
    expect(prompt).toContain('prêtre=RIB ET MAIL')
  })

  it('marks a missing branch, commits or owner rather than leaving it blank', () => {
    const prompt = buildWorktreeCommentsPrompt([entry({ branch: null, commits: [], owner: null })])
    expect(prompt).toContain('branche=-')
    expect(prompt).toContain('commits=-')
    expect(prompt).toContain('prêtre=-')
  })
})

describe('parseWorktreeComments', () => {
  it('keeps comments whose path is known, keyed by path', () => {
    const raw = { comments: [{ path: '/a', comment: 'un brouillon' }, { path: '/b', comment: 'fusionné' }] }
    expect(parseWorktreeComments(raw, new Set(['/a', '/b']))).toEqual({ '/a': 'un brouillon', '/b': 'fusionné' })
  })

  it('drops comments whose path is not among the ones asked about', () => {
    const raw = { comments: [{ path: '/a', comment: 'ok' }, { path: '/ghost', comment: 'inventé' }] }
    expect(parseWorktreeComments(raw, new Set(['/a']))).toEqual({ '/a': 'ok' })
  })

  it('drops malformed entries (missing or wrong-typed path/comment)', () => {
    const raw = { comments: [{ path: '/a', comment: 'ok' }, { path: '/b' }, { comment: 'sans chemin' }, null, 'x'] }
    expect(parseWorktreeComments(raw, new Set(['/a', '/b']))).toEqual({ '/a': 'ok' })
  })

  it('is empty for anything that is not a well-shaped object', () => {
    expect(parseWorktreeComments(null, new Set())).toEqual({})
    expect(parseWorktreeComments({}, new Set())).toEqual({})
    expect(parseWorktreeComments({ comments: 'nope' }, new Set())).toEqual({})
  })
})

const resultMessage = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output })

describe('worktreeComments', () => {
  it('asks the model and filters its answer against the entries given', async () => {
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ comments: [{ path: '/w/.worktrees/p/old', comment: 'Un vieux brouillon.' }, { path: '/ghost', comment: 'ne devrait pas apparaître' }] })
      },
    } as never)
    const out = await worktreeComments([entry()])
    expect(out).toEqual({ '/w/.worktrees/p/old': 'Un vieux brouillon.' })
  })

  it('is an empty object when the model gives nothing back', async () => {
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () {} } as never)
    expect(await worktreeComments([entry()])).toEqual({})
  })

  it('is an empty object right away when there is nothing to ask about (no model call)', async () => {
    expect(await worktreeComments([])).toEqual({})
    expect(query).not.toHaveBeenCalled()
  })
})
