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
  commits: ['add the tests', 'fix the cart'],
  dirty: 0,
  unpushed: 0,
  owner: 'RIB ET MAIL',
  ...over,
})

describe('buildWorktreeCommentsPrompt', () => {
  it('writes one line per worktree with its path, branch, commits, safety counts and owner', () => {
    const prompt = buildWorktreeCommentsPrompt([entry()])
    expect(prompt).toContain('path=/w/.worktrees/p/old')
    expect(prompt).toContain('branch=sangha/lead-1')
    expect(prompt).toContain('add the tests | fix the cart')
    expect(prompt).toContain('dirty=0')
    expect(prompt).toContain('unpushed=0')
    expect(prompt).toContain('session=RIB ET MAIL')
  })

  it('marks a missing branch, commits or owner rather than leaving it blank', () => {
    const prompt = buildWorktreeCommentsPrompt([entry({ branch: null, commits: [], owner: null })])
    expect(prompt).toContain('branch=-')
    expect(prompt).toContain('commits=-')
    expect(prompt).toContain('session=-')
  })
})

describe('parseWorktreeComments', () => {
  it('keeps comments whose path is known, keyed by path', () => {
    const raw = { comments: [{ path: '/a', comment: 'a draft' }, { path: '/b', comment: 'merged' }] }
    expect(parseWorktreeComments(raw, new Set(['/a', '/b']))).toEqual({ '/a': 'a draft', '/b': 'merged' })
  })

  it('drops comments whose path is not among the ones asked about', () => {
    const raw = { comments: [{ path: '/a', comment: 'ok' }, { path: '/ghost', comment: 'made up' }] }
    expect(parseWorktreeComments(raw, new Set(['/a']))).toEqual({ '/a': 'ok' })
  })

  it('drops malformed entries (missing or wrong-typed path/comment)', () => {
    const raw = { comments: [{ path: '/a', comment: 'ok' }, { path: '/b' }, { comment: 'no path' }, null, 'x'] }
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
        yield resultMessage({ comments: [{ path: '/w/.worktrees/p/old', comment: 'An old draft.' }, { path: '/ghost', comment: 'should not show up' }] })
      },
    } as never)
    const out = await worktreeComments([entry()])
    expect(out).toEqual({ '/w/.worktrees/p/old': 'An old draft.' })
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
