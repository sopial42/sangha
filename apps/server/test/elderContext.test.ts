import { describe, expect, it } from 'vitest'
import type { ElderSettings } from '@sangha/shared'
import { Store, type SessionRow } from '../src/db'
import { buildContext } from '../src/elderContext'

const SETTINGS: ElderSettings = {
  enabled: true,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: true },
  projects: ['robia'],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}

const row = (id: string, project = 'robia'): SessionRow => ({
  id,
  project,
  agent: 'lead',
  title: 't',
  createdAt: 1,
  claudeSessionId: null,
  branch: null,
  worktree: null,
  baseSha: null,
  archivedAt: null,
  lastSeenSeq: 0,
})

describe('buildContext', () => {
  it('is empty with newItems = 0 when there is nothing new', () => {
    const store = new Store(':memory:')
    expect(buildContext(SETTINGS, 0, store)).toEqual({ text: '', newItems: 0, feedbackIds: [] })
  })

  it('includes pending feedback, counted in newItems', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'too long', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext(SETTINGS, 0, store)
    expect(ctx.text).toContain('too long')
    expect(ctx.newItems).toBe(1)
  })

  it('omits the feedback block when the manual level is off', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'too long', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, levels: { ...SETTINGS.levels, manual: false } }, 0, store)
    expect(ctx.text).not.toContain('too long')
    expect(ctx.newItems).toBe(0)
  })

  it('excludes a project not followed', () => {
    const store = new Store(':memory:')
    store.createSession(row('a', 'other'))
    store.archive('a')
    store.setNote('a', 'nirvana', String(store.getSession('a')!.archivedAt), { summary: 'secret summary' })
    const ctx = buildContext(SETTINGS, 0, store) // 'other' is not in settings.projects
    expect(ctx.text).not.toContain('secret summary')
  })

  it('restricts to one session for a conversation-end pass, skipping the project and sangha blocks', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.createSession(row('b'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'up', comment: 'for a', excerpt: 'x', createdAt: 1, processedAt: null })
    store.addFeedback({ id: 'f2', sessionId: 'b', eventSeq: null, rating: 'up', comment: 'for b', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext(SETTINGS, 0, store, 'a')
    expect(ctx.text).toContain('for a')
    expect(ctx.text).not.toContain('for b')
    expect(ctx.newItems).toBe(1)
  })

  it('truncates to maxInputChars, feedback first', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: null, comment: 'x'.repeat(100), excerpt: 'y'.repeat(100), createdAt: 1, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, maxInputChars: 50 }, 0, store)
    expect(ctx.text.length).toBeLessThanOrEqual(80)
  })

  it('returns only the feedback ids actually included, after the 50-item cap', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    for (let i = 0; i < 52; i++) {
      store.addFeedback({ id: `f${i}`, sessionId: 'a', eventSeq: null, rating: 'up', comment: `c${i}`, excerpt: 'x', createdAt: i, processedAt: null })
    }
    const ctx = buildContext(SETTINGS, 0, store)
    expect(ctx.feedbackIds).toHaveLength(50)
    expect(ctx.feedbackIds).not.toContain('f50')
    expect(ctx.feedbackIds).not.toContain('f51')
  })

  it('excludes a feedback id that falls outside the character budget: a truncated feedback does not count as read', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: null, comment: 'x'.repeat(20), excerpt: 'y'.repeat(20), createdAt: 1, processedAt: null })
    store.addFeedback({ id: 'f2', sessionId: 'a', eventSeq: null, rating: null, comment: 'z'.repeat(20), excerpt: 'w'.repeat(20), createdAt: 2, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, maxInputChars: 100 }, 0, store)
    expect(ctx.feedbackIds).toEqual(['f1'])
  })

  it('includes no feedback id when the manual level is off, even for a conversation-end pass', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'up', comment: 'too verbose', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, levels: { ...SETTINGS.levels, manual: false } }, 0, store, 'a')
    expect(ctx.feedbackIds).toEqual([])
    expect(ctx.text).not.toContain('too verbose')
  })
})
