import { describe, expect, it, vi } from 'vitest'
import { mapPullRequest, PullRequests, type GhPullRequest } from '../src/pulls'

const gh = (over: Partial<GhPullRequest> = {}): GhPullRequest => ({
  number: 1,
  url: 'https://github.com/o/r/pull/1',
  title: 'Titre',
  state: 'OPEN',
  isDraft: false,
  ...over,
})

describe('mapPullRequest', () => {
  it('maps an open pull request', () => {
    expect(mapPullRequest([gh({ state: 'OPEN', isDraft: false })], 'sangha/x')).toEqual({
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      title: 'Titre',
      state: 'open',
      branch: 'sangha/x',
    })
  })

  it('maps a draft pull request', () => {
    expect(mapPullRequest([gh({ state: 'OPEN', isDraft: true })], 'sangha/x')).toMatchObject({ state: 'draft' })
  })

  it('maps a merged pull request', () => {
    expect(mapPullRequest([gh({ state: 'MERGED' })], 'sangha/x')).toMatchObject({ state: 'merged' })
  })

  it('maps a closed pull request', () => {
    expect(mapPullRequest([gh({ state: 'CLOSED' })], 'sangha/x')).toMatchObject({ state: 'closed' })
  })

  it('returns null for an empty list', () => {
    expect(mapPullRequest([], 'sangha/x')).toBeNull()
  })

  it('prefers an open pull request over a more recent closed one', () => {
    const items = [gh({ number: 2, state: 'CLOSED' }), gh({ number: 1, state: 'OPEN' })]
    expect(mapPullRequest(items, 'sangha/x')?.number).toBe(1)
  })

  it('picks the first (most recent) closed or merged one when none is open', () => {
    const items = [gh({ number: 3, state: 'CLOSED' }), gh({ number: 2, state: 'MERGED' })]
    expect(mapPullRequest(items, 'sangha/x')?.number).toBe(3)
  })
})

describe('PullRequests', () => {
  it('starts with nothing cached', () => {
    const pr = new PullRequests(
      () => {},
      async () => null,
    )
    expect(pr.of('/some/folder')).toBeNull()
  })

  it('fills the cache from a lookup and reports the change', async () => {
    const changed: string[] = []
    const found = { number: 1, url: 'u', title: 't', state: 'open' as const, branch: 'b' }
    const pr = new PullRequests(
      (cwd) => changed.push(cwd),
      async () => found,
    )
    pr.tick(['/f'])
    await pr.drained()
    expect(pr.of('/f')).toEqual(found)
    expect(changed).toEqual(['/f'])
  })

  it('does not call the lookup again for a folder checked less than 2 minutes ago', async () => {
    const lookup = vi.fn(async () => null)
    const pr = new PullRequests(() => {}, lookup)
    pr.tick(['/f'])
    await pr.drained()
    pr.tick(['/f'])
    await pr.drained()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('soon() bypasses the spacing so the folder is checked again right away', async () => {
    const lookup = vi.fn(async () => null)
    const pr = new PullRequests(() => {}, lookup)
    pr.tick(['/f'])
    await pr.drained()
    pr.soon('/f')
    await pr.drained()
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('does not report a change when the lookup result is unchanged', async () => {
    const changed: string[] = []
    const found = { number: 1, url: 'u', title: 't', state: 'open' as const, branch: 'b' }
    const pr = new PullRequests(
      (cwd) => changed.push(cwd),
      async () => found,
    )
    pr.tick(['/f'])
    await pr.drained()
    pr.soon('/f')
    await pr.drained()
    expect(changed).toEqual(['/f'])
  })

  it('runs lookups for several folders one at a time, never concurrently', async () => {
    let running = 0
    let concurrent = false
    const lookup = vi.fn(async () => {
      running++
      if (running > 1) concurrent = true
      await new Promise((r) => setTimeout(r, 5))
      running--
      return null
    })
    const pr = new PullRequests(() => {}, lookup)
    pr.tick(['/a', '/b', '/c'])
    await pr.drained()
    expect(lookup).toHaveBeenCalledTimes(3)
    expect(concurrent).toBe(false)
  })
})
