import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, type SessionRow } from '../src/db'

const row = (id: string): SessionRow => ({
  id,
  project: 'robia',
  agent: 'kiat-team-lead',
  title: 't',
  createdAt: 1,
  claudeSessionId: null,
  branch: 'sangha/x',
  worktree: '/w/x',
  baseSha: 'abc',
  archivedAt: null,
  lastSeenSeq: 0,
})

describe('Store', () => {
  it('knows when a priest fell idle and whether it was seen', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.append('a', { t: 'busy', busy: true })
    s.append('a', { t: 'busy', busy: false })
    expect(s.lastIdleSeq('a')).toBe(2)
    expect(s.getSession('a')!.lastSeenSeq).toBe(0)
    s.markSeen('a')
    expect(s.getSession('a')!.lastSeenSeq).toBe(2)
    expect(s.lastEvent('a', 'busy')!.ev.busy).toBe(false)
  })

  it('gives each project its own robe color, stable over time', () => {
    const s = new Store(':memory:')
    const palette = ['red', 'blue']
    expect(s.projectColor('robia', palette)).toBe('red')
    expect(s.projectColor('robin', palette)).toBe('blue')
    expect(s.projectColor('robia', palette)).toBe('red')
  })

  it('keeps what a small model wrote, with the state it describes', () => {
    const s = new Store(':memory:')
    expect(s.note('a', 'progress')).toBeNull()
    s.setNote('a', 'progress', 'idle:4', { goal: 'g', state: 's', next: 'n' })
    s.setNote('a', 'progress', 'idle:9', { goal: 'g2', state: 's2', next: 'n2' })
    const n = s.note<{ goal: string }>('a', 'progress')!
    expect(n.key).toBe('idle:9')
    expect(n.value.goal).toBe('g2')
    expect(s.note('a', 'recap')).toBeNull()
  })

  it('finds novices that never reported back', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.append('a', { t: 'monk.summoned', monkId: 'n1', agentType: 'x', description: 'd', prompt: '', depth: 1 })
    s.append('a', { t: 'monk.summoned', monkId: 'n2', agentType: 'x', description: 'd', prompt: '', depth: 1 })
    s.append('a', { t: 'monk.done', monkId: 'n1', status: 'completed', summary: 'ok' })
    expect(s.danglingNovices('a')).toEqual(['n2'])
  })

  it('hides archived sessions', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.createSession(row('b'))
    s.archive('a')
    expect(s.listSessions().map((r) => r.id)).toEqual(['b'])
  })

  describe('archivedSessions and unarchive', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('lists archived sessions newest first', () => {
      const s = new Store(':memory:')
      s.createSession(row('a'))
      s.createSession(row('b'))
      vi.setSystemTime(1000)
      s.archive('a')
      vi.setSystemTime(2000)
      s.archive('b')
      expect(s.archivedSessions().map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('brings an archived session back with unarchive', () => {
      const s = new Store(':memory:')
      s.createSession(row('a'))
      s.archive('a')
      expect(s.listSessions()).toEqual([])
      s.unarchive('a')
      expect(s.listSessions().map((r) => r.id)).toEqual(['a'])
      expect(s.getSession('a')!.archivedAt).toBeNull()
      expect(s.archivedSessions()).toEqual([])
    })
  })

  it('allSessions lists live and archived sessions alike, for the cost report', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.createSession(row('b'))
    s.archive('a')
    expect(s.allSessions().map((r) => r.id)).toEqual(['a', 'b'])
  })
})
