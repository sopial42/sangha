import { describe, expect, it } from 'vitest'
import type { ElderSettings, Quota } from '@sangha/shared'
import { due, elderEngine, type PendingSession } from '../src/elderSchedule'

const SETTINGS: ElderSettings = {
  enabled: true,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: false },
  projects: [],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}
const PROVIDER_SETTINGS: ElderSettings = { ...SETTINGS, model: 'ovh::llama-4' }

const quota = (pct: number | null): Quota | null => (pct === null ? null : { status: 'allowed', fiveHour: null, sevenDay: { utilization: pct / 100, resetsAt: null } })

// 2026-01-01 is a Thursday; 2026-01-02 a Friday.
const THURSDAY_NOON = new Date(2026, 0, 1, 12, 0, 0).getTime()
const FRIDAY_2300 = new Date(2026, 0, 2, 23, 0, 0).getTime()

describe('elderEngine', () => {
  it('reads claude from a bare alias, a provider from provider::model', () => {
    expect(elderEngine('sonnet')).toBe('claude')
    expect(elderEngine('')).toBe('claude')
    expect(elderEngine('ovh::llama-4')).toBe('provider')
  })
})

describe('due: weekly (Claude)', () => {
  it('fires at Thursday 12:00 when the week quota is OK', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(15), [])).toEqual({ kind: 'weekly' })
  })

  it('does not fire when the week quota is over the threshold', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(30), [])).toBeNull()
  })

  it('does not fire when the quota is unknown', () => {
    expect(due(THURSDAY_NOON, SETTINGS, null, [])).toBeNull()
  })

  it('retries hourly: still null with bad quota, fires once quota clears', () => {
    const at16 = THURSDAY_NOON + 4 * 3600_000
    expect(due(at16, SETTINGS, quota(30), [])).toBeNull()
    expect(due(at16, SETTINGS, quota(10), [])).toEqual({ kind: 'weekly' })
  })

  it('gives up at Friday 23:00, recording a skip, and never twice for the same week', () => {
    expect(due(FRIDAY_2300 - 1, SETTINGS, quota(90), [])).toBeNull()
    expect(due(FRIDAY_2300 + 1, SETTINGS, quota(90), [])).toEqual({ kind: 'skipped' })
    const resolved = { ...SETTINGS, lastRunAt: FRIDAY_2300 + 1 }
    expect(due(FRIDAY_2300 + 2, resolved, quota(90), [])).toBeNull()
  })

  it('does nothing once disabled', () => {
    expect(due(THURSDAY_NOON, { ...SETTINGS, enabled: false }, quota(10), [])).toBeNull()
  })

  it('does not refire the same week once already run', () => {
    const ranToday = { ...SETTINGS, lastRunAt: THURSDAY_NOON }
    expect(due(THURSDAY_NOON + 1000, ranToday, quota(5), [])).toBeNull()
  })
})

describe('due: daily and end-of-conversation (a provider)', () => {
  const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
  const session = (over: Partial<PendingSession>): PendingSession => ({ id: 's1', archived: false, idleMs: 0, hasPendingFeedback: false, ...over })

  it('fires once at dailyAt', () => {
    expect(due(morning, PROVIDER_SETTINGS, null, [])).toEqual({ kind: 'daily' })
  })

  it('does not refire later the same day', () => {
    expect(due(morning + 1, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [])).toBeNull()
  })

  it('fires on a closed session with an unprocessed feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ archived: true, hasPendingFeedback: true })])).toEqual({ kind: 'conversation', sessionId: 's1' })
  })

  it('fires on 30 min of inactivity with an unprocessed feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ idleMs: 31 * 60_000, hasPendingFeedback: true })])).toEqual({ kind: 'conversation', sessionId: 's1' })
  })

  it('does nothing for a finished session with no feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ archived: true, hasPendingFeedback: false })])).toBeNull()
  })

  it('does not fire on a live session still under 30 minutes idle', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ idleMs: 5 * 60_000, hasPendingFeedback: true })])).toBeNull()
  })
})

describe('due: backoff after a failed model call (retryAfter)', () => {
  it('suppresses a weekly pass still inside the backoff window', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(10), [], { retryAfter: THURSDAY_NOON + 1 })).toBeNull()
  })

  it('fires again once the backoff window has passed', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(10), [], { retryAfter: THURSDAY_NOON - 1 })).toEqual({ kind: 'weekly' })
  })

  it('suppresses a daily pass still inside the backoff window', () => {
    const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
    expect(due(morning, PROVIDER_SETTINGS, null, [], { retryAfter: morning + 1 })).toBeNull()
  })

  it('does not gate a conversation pass with retryAfter: it has its own block list instead', () => {
    const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
    const noon = morning + 4 * 3600_000
    const session: PendingSession = { id: 's1', archived: true, idleMs: 0, hasPendingFeedback: true }
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session], { retryAfter: noon + 1 })).toEqual({ kind: 'conversation', sessionId: 's1' })
  })
})

describe('due: blocked sessions (repeated conversation failures)', () => {
  it('skips a session on the block list for the conversation pass', () => {
    const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
    const noon = morning + 4 * 3600_000
    const session: PendingSession = { id: 's1', archived: true, idleMs: 0, hasPendingFeedback: true }
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session], { blockedSessions: new Set(['s1']) })).toBeNull()
  })
})

describe('due: the manual level off disables the conversation pass', () => {
  it('never proposes a conversation pass when the manual level is off', () => {
    const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
    const noon = morning + 4 * 3600_000
    const off: ElderSettings = { ...PROVIDER_SETTINGS, lastRunAt: morning, levels: { ...PROVIDER_SETTINGS.levels, manual: false } }
    const session: PendingSession = { id: 's1', archived: true, idleMs: 0, hasPendingFeedback: true }
    expect(due(noon, off, null, [session])).toBeNull()
  })
})
