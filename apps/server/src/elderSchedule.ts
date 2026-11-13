import type { ElderSettings, Quota } from '@sangha/shared'

export type ElderPass = { kind: 'weekly' } | { kind: 'daily' } | { kind: 'conversation'; sessionId: string } | { kind: 'skipped' }

export type PendingSession = {
  id: string
  /** It was closed: a finished conversation, whatever its idle time. */
  archived: boolean
  /** Milliseconds since the end of its last turn (ignored when `archived`). */
  idleMs: number
  /** At least one feedback item about it has no `processedAt` yet. */
  hasPendingFeedback: boolean
}

const INACTIVE_MS = 30 * 60_000
const SKIP_HOUR = 23 // "Friday 23:00": the day after the weekly day, at this hour

/** 'claude': the Advisor thinks on the subscription (weekly rhythm); 'provider': another provider (daily plus end of conversation). */
export const elderEngine = (model: string): 'claude' | 'provider' => (model.includes('::') ? 'provider' : 'claude')

function atTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

/** Most recent occurrence of `day` (0-6, JS convention) at `at`, at or before `now`. */
function lastOccurrence(now: Date, day: number, at: string): Date {
  const diff = (now.getDay() - day + 7) % 7
  const d = new Date(now)
  d.setDate(d.getDate() - diff)
  const t = atTime(d, at)
  return t > now ? new Date(t.getTime() - 7 * 86_400_000) : t
}

const quotaOk = (quota: Quota | null, maxPct: number) => !!quota?.sevenDay && quota.sevenDay.utilization * 100 <= maxPct

export type DueOptions = {
  /** No scheduled pass (daily or weekly) before this date: backoff after a model failure. Ignored by "run now", which never calls `due()`. */
  retryAfter?: number | null
  /** Sessions whose end-of-conversation pass failed too many times in a row: skipped for this rhythm (their feedback waits for the next daily or weekly pass). */
  blockedSessions?: Set<string>
}

export function due(now: number, settings: ElderSettings, quota: Quota | null, pending: PendingSession[], options: DueOptions = {}): ElderPass | null {
  if (!settings.enabled) return null
  const nowD = new Date(now)
  const lastRun = settings.lastRunAt
  const inBackoff = options.retryAfter != null && now < options.retryAfter

  if (elderEngine(settings.model) === 'claude') {
    const windowStart = lastOccurrence(nowD, settings.weekly.day, settings.weekly.at)
    if (nowD < windowStart) return null
    if (lastRun != null && lastRun >= windowStart.getTime()) return null
    if (quotaOk(quota, settings.weekly.maxWeekUsedPct)) return inBackoff ? null : { kind: 'weekly' }
    const windowEnd = atTime(new Date(windowStart.getTime() + 86_400_000), `${SKIP_HOUR}:00`)
    return nowD > windowEnd ? { kind: 'skipped' } : null
  }

  const todayAt = atTime(nowD, settings.dailyAt)
  if (nowD >= todayAt && (lastRun == null || lastRun < todayAt.getTime())) return inBackoff ? null : { kind: 'daily' }
  if (!settings.levels.manual) return null // end-of-conversation passes exist only for feedback
  const finished = pending.find((p) => p.hasPendingFeedback && !options.blockedSessions?.has(p.id) && (p.archived || p.idleMs >= INACTIVE_MS))
  return finished ? { kind: 'conversation', sessionId: finished.id } : null
}
