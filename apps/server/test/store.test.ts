import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElderTopic } from '@sangha/shared'
import { LOOP_STOP_MESSAGE, Store, type SessionRow } from '../src/db'

const DONE = { t: 'turn.done' as const, ok: true, costUsdEquiv: 0, durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }

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
  it('knows who else still works in a worktree, so closing one keeps it for the other', () => {
    const s = new Store(':memory:')
    s.createSession(row('old'))
    s.createSession(row('new'))
    s.createSession({ ...row('elsewhere'), worktree: '/w/y' })
    expect(s.othersInWorktree('/w/x', 'old')).toEqual(['new'])
    s.archive('new')
    expect(s.othersInWorktree('/w/x', 'old')).toEqual([])
  })

  it('keeps messages queued while it works, editable until they leave', () => {
    const s = new Store(':memory:')
    s.addQueued('a', { id: 'm1', text: 'one', at: 1 })
    s.addQueued('a', { id: 'm2', text: 'two', at: 2 })
    s.addQueued('b', { id: 'm3', text: 'other', at: 3 })
    expect(s.editQueued('a', 'm1', 'one again')).toBe(true)
    expect(s.editQueued('b', 'm1', 'not its own')).toBe(false)
    expect(s.takeQueued('a', ['m2']).map((m) => m.text)).toEqual(['two'])
    expect(s.takeQueued('a').map((m) => m.text)).toEqual(['one again'])
    expect(s.queued('a')).toEqual([])
    expect(s.editQueued('a', 'm1', 'too late')).toBe(false)
    expect(s.queued('b')).toHaveLength(1)
  })

  it('knows when a session fell idle and whether it was seen', () => {
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

  it('gives each project its own color, stable over time', () => {
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

  it('keeps a free-text note per session, cleared by an empty one', () => {
    const s = new Store(':memory:')
    expect(s.notes().get('a')).toBeUndefined()
    s.setSessionNote('a', 'keep an eye on the migrations')
    expect(s.notes().get('a')).toBe('keep an eye on the migrations')
    s.setSessionNote('a', null)
    expect(s.notes().get('a')).toBeUndefined()
  })

  it('keeps who is set aside, cleared by taking it back', () => {
    const s = new Store(':memory:')
    expect(s.lotusIds().has('a')).toBe(false)
    s.setLotus('a', true)
    expect(s.lotusIds().has('a')).toBe(true)
    s.setLotus('a', false)
    expect(s.lotusIds().has('a')).toBe(false)
  })

  it('finds subagents that never reported back', () => {
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

  describe('lastAutonomy', () => {
    it('is null when it never had a /goal or /loop', () => {
      const s = new Store(':memory:')
      s.createSession(row('a'))
      s.append('a', { t: 'user.message', text: 'fais X' })
      expect(s.lastAutonomy('a')).toBeNull()
    })

    describe('goal (unchanged behaviour, under the new shape)', () => {
      it('is active with the text right after /goal <text>', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/goal keep going until production' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'keep going until production', active: true })
      })

      it('goes inactive on /goal clear, keeping the text of the last real goal', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/goal keep going until production' })
        s.append('a', { t: 'user.message', text: '/goal clear' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'keep going until production', active: false })
      })

      it('accepts stop|off|cancel and a bare /goal as clearing it too, case-insensitively', () => {
        for (const clear of ['/goal stop', '/goal OFF', '/goal Cancel', '/goal']) {
          const s = new Store(':memory:')
          s.createSession(row('a'))
          s.append('a', { t: 'user.message', text: '/goal a goal' })
          s.append('a', { t: 'user.message', text: clear })
          expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'a goal', active: false })
        }
      })

      it('a fresh /goal reactivates with its own text, replacing the old one', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/goal premier objectif' })
        s.append('a', { t: 'user.message', text: '/goal clear' })
        s.append('a', { t: 'user.message', text: '/goal second objectif' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'second objectif', active: true })
      })

      it('ignores a message that merely starts with /goal, like /goalkeeper', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/goalkeeper save the day' })
        expect(s.lastAutonomy('a')).toBeNull()
      })

      it('does not mix up autonomy between sessions', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.createSession(row('b'))
        s.append('a', { t: 'user.message', text: '/goal objectif de a' })
        s.append('b', { t: 'user.message', text: 'unrelated' })
        expect(s.lastAutonomy('b')).toBeNull()
        expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'objectif de a', active: true })
      })
    })

    describe('loop', () => {
      it('is active right after /loop <text>, self-paced (no interval) and no nextAt before a wake-up', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch the deployment' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch the deployment', interval: null, nextAt: null, active: true })
      })

      it('parses a leading interval token, keeping the rest as the text', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop 5m check the deployment' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'check the deployment', interval: '5m', nextAt: null, active: true })
      })

      it('ignores a token that merely looks like an interval, like 5mb, keeping it as part of the text', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop 5mb of logs to watch' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: '5mb of logs to watch', interval: null, nextAt: null, active: true })
      })

      it('stays active before any turn completes, even with no loop.wake yet', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'busy', busy: true }) // still on its first turn
        expect(s.lastAutonomy('a')?.active).toBe(true)
      })

      it('picks up nextAt from the latest loop.wake, once it reschedules itself', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'loop.wake', nextAt: 123456, stop: false })
        s.append('a', DONE)
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: null, nextAt: 123456, active: true })
      })

      it('ScheduleWakeup stop:true ends a self-paced loop', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'loop.wake', nextAt: 123456, stop: false })
        s.append('a', DONE)
        s.append('a', { t: 'loop.wake', nextAt: null, stop: true })
        s.append('a', DONE)
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: null, nextAt: null, active: false })
      })

      it('a turn ending without rescheduling silently ends a self-paced loop', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'loop.wake', nextAt: 123456, stop: false })
        s.append('a', DONE) // woke up, rescheduled: fine
        s.append('a', DONE) // woke up again but this time did not reschedule: the loop dies here
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: null, nextAt: null, active: false })
      })

      it('a fixed-interval loop (CronCreate) stays active across turns without rescheduling itself', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop 5m watch' })
        s.append('a', { t: 'loop.wake', nextAt: 999, stop: false }) // CronCreate, once
        s.append('a', DONE) // a fire of the cron, no rescheduling needed
        s.append('a', DONE) // another fire
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: '5m', nextAt: 999, active: true })
      })

      it('CronDelete ends a fixed-interval loop', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop 5m watch' })
        s.append('a', { t: 'loop.wake', nextAt: 999, stop: false })
        s.append('a', { t: 'loop.wake', nextAt: null, stop: true })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: '5m', nextAt: null, active: false })
      })

      it('the Sangha stop marker ends a loop even without a stop-flagged loop.wake', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'loop.wake', nextAt: 123456, stop: false })
        s.append('a', { t: 'user.message', text: LOOP_STOP_MESSAGE })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: null, nextAt: null, active: false })
      })
      it('the legacy French stop marker still ends a loop (older event logs)', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'user.message', text: "Arrête la boucle /loop : ne programme plus aucun réveil (ScheduleWakeup avec stop) et supprime tes tâches CronCreate. Ne fais rien d'autre." })
        expect(s.lastAutonomy('a')?.active).toBe(false)
      })
    })

    describe('switching mode: never both at once', () => {
      it('a /loop after a cleared goal replaces it: only the loop shows', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/goal a goal' })
        s.append('a', { t: 'user.message', text: '/goal clear' })
        s.append('a', { t: 'user.message', text: '/loop watch' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'loop', text: 'watch', interval: null, nextAt: null, active: true })
      })

      it('a /goal after a stopped loop replaces it: only the goal shows', () => {
        const s = new Store(':memory:')
        s.createSession(row('a'))
        s.append('a', { t: 'user.message', text: '/loop watch' })
        s.append('a', { t: 'user.message', text: LOOP_STOP_MESSAGE })
        s.append('a', { t: 'user.message', text: '/goal a goal' })
        expect(s.lastAutonomy('a')).toEqual({ mode: 'goal', text: 'a goal', active: true })
      })
    })
  })
})

describe('feedback', () => {
  it('keeps feedback pending until marked processed', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: 3, rating: 'down', comment: 'too verbose', excerpt: 'Agent: ...', createdAt: 1, processedAt: null })
    expect(s.pendingFeedback().map((f) => f.id)).toEqual(['f1'])
    s.markFeedbackProcessed(['f1'], 99)
    expect(s.pendingFeedback()).toEqual([])
    expect(s.feedbackForSession('a')[0]!.processedAt).toBe(99)
  })

  it('freezes an excerpt around the commented message, or the conversation tail when none is given', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.append('a', { t: 'user.message', text: 'one' })
    s.append('a', { t: 'buddha.text', text: 'two' })
    s.append('a', { t: 'user.message', text: 'three' })
    expect(s.excerptAround('a', 2)).toContain('Agent: two')
    expect(s.excerptAround('a', null)).toContain('User: three')
  })
})

describe('Advisor topics, reports and chat', () => {
  it('creates and updates a topic by id, reading it back', () => {
    const s = new Store(':memory:')
    const t: ElderTopic = { id: 't1', scope: 'sangha', title: 'Flaky MCP', detail: 'd', evidence: ['e1'], status: 'proposed', createdAt: 1, updatedAt: 1 }
    s.upsertElderTopic(t)
    s.upsertElderTopic({ ...t, status: 'accepted', updatedAt: 2 })
    expect(s.elderTopic('t1')!.status).toBe('accepted')
    expect(s.elderTopics()).toHaveLength(1)
  })

  it('keeps reports newest first', () => {
    const s = new Store(':memory:')
    s.addElderReport({ id: 'r1', kind: 'weekly', text: 'nothing to report', topicIds: [], costUsd: 0.01, tokens: 500, createdAt: 1 })
    s.addElderReport({ id: 'r2', kind: 'manual', text: 'a topic', topicIds: ['t1'], costUsd: null, tokens: null, createdAt: 2 })
    expect(s.elderReports().map((r) => r.id)).toEqual(['r2', 'r1'])
  })

  it('keeps the chat in order, oldest first, limited to the last N', () => {
    const s = new Store(':memory:')
    s.addElderChatMessage('user', 'one', 1)
    s.addElderChatMessage('elder', 'two', 2)
    expect(s.elderChat(1).map((t) => t.text)).toEqual(['two'])
    expect(s.elderChat().map((t) => t.text)).toEqual(['one', 'two'])
  })
})

describe('elderSanghaStats', () => {
  it('aggregates tool failures by server, session errors, cost and fresh starts since a date', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.createSession(row('b'))
    s.append('a', { t: 'tool.error', tool: 'mcp__bitbucket__get_pr', server: 'bitbucket', message: 'timeout' })
    s.append('a', { t: 'tool.error', tool: 'mcp__bitbucket__list_prs', server: 'bitbucket', message: 'timeout' })
    s.append('a', { t: 'error', message: 'oops' })
    s.append('a', { t: 'turn.done', ok: true, costUsdEquiv: 1.5, durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    s.setSuccessor('a', 'b')
    const stats = s.elderSanghaStats(0)
    expect(stats.toolErrorsByServer).toEqual({ bitbucket: 2 })
    expect(stats.sessionErrors).toBe(1)
    expect(stats.costUsd).toBeCloseTo(1.5)
    expect(stats.renewals).toBe(1)
  })
})
