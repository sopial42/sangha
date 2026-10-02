import { describe, expect, it } from 'vitest'
import { Store, type SessionRow } from '../src/db'
import { carriedOnIn } from '../src/chain'

const row = (id: string, over: Partial<SessionRow> = {}): SessionRow => ({
  id,
  project: 'poc',
  agent: 'lead',
  title: 'regarde les resultats du poc',
  createdAt: 1_000,
  claudeSessionId: null,
  branch: null,
  worktree: null,
  baseSha: null,
  archivedAt: null,
  lastSeenSeq: 0,
  ...over,
})

describe('carriedOnIn', () => {
  it('follows fresh sessions to the one still at work', () => {
    const s = new Store(':memory:')
    s.createSession(row('a', { archivedAt: 2_000 }))
    s.createSession(row('b', { createdAt: 2_000, archivedAt: 3_000 }))
    s.createSession(row('c', { createdAt: 3_000 }))
    s.setSuccessor('a', 'b')
    s.setSuccessor('b', 'c')
    expect(carriedOnIn(s, 'a')).toBe('c')
    expect(carriedOnIn(s, 'b')).toBe('c')
  })

  it('finds the fresh session of a renewal made before links were kept: same project and title, created as the old one left', () => {
    const s = new Store(':memory:')
    s.createSession(row('a', { archivedAt: 2_000 }))
    s.createSession(row('other', { title: 'autre chose', createdAt: 2_000 }))
    s.createSession(row('b', { createdAt: 1_999 }))
    expect(carriedOnIn(s, 'a')).toBe('b')
  })

  it('is null when the chain ends in nirvana too', () => {
    const s = new Store(':memory:')
    s.createSession(row('a', { archivedAt: 2_000 }))
    s.createSession(row('b', { createdAt: 2_000, archivedAt: 3_000 }))
    s.setSuccessor('a', 'b')
    expect(carriedOnIn(s, 'a')).toBeNull()
  })

  it('never loops', () => {
    const s = new Store(':memory:')
    s.createSession(row('a', { archivedAt: 2_000 }))
    s.createSession(row('b', { archivedAt: 3_000 }))
    s.setSuccessor('a', 'b')
    s.setSuccessor('b', 'a')
    expect(carriedOnIn(s, 'a')).toBeNull()
  })
})
