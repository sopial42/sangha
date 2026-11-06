import type { ElderSettings, Quota } from '@sangha/shared'

export type ElderPass = { kind: 'weekly' } | { kind: 'daily' } | { kind: 'conversation'; sessionId: string } | { kind: 'skipped' }

export type PendingSession = {
  id: string
  /** Il est parti au nirvana : une conversation finie, quel que soit son temps d'inactivité. */
  archived: boolean
  /** Millisecondes depuis la fin de son dernier tour (ignoré si `archived`). */
  idleMs: number
  /** Au moins un retour sur lui n'a pas encore `processedAt`. */
  hasPendingFeedback: boolean
}

const INACTIVE_MS = 30 * 60_000
const SKIP_HOUR = 23 // « vendredi 23:00 » : le jour suivant le jour hebdomadaire, à cette heure

/** 'claude' : Ananda pense avec l'abonnement (rythme hebdomadaire) ; 'provider' : un fournisseur (quotidien + fin de conversation). */
export const elderEngine = (model: string): 'claude' | 'provider' => (model.includes('::') ? 'provider' : 'claude')

function atTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

/** Occurrence la plus récente de `day` (0-6, convention JS) à `at`, à ou avant `now`. */
function lastOccurrence(now: Date, day: number, at: string): Date {
  const diff = (now.getDay() - day + 7) % 7
  const d = new Date(now)
  d.setDate(d.getDate() - diff)
  const t = atTime(d, at)
  return t > now ? new Date(t.getTime() - 7 * 86_400_000) : t
}

const quotaOk = (quota: Quota | null, maxPct: number) => !!quota?.sevenDay && quota.sevenDay.utilization * 100 <= maxPct

export function due(now: number, settings: ElderSettings, quota: Quota | null, pending: PendingSession[]): ElderPass | null {
  if (!settings.enabled) return null
  const nowD = new Date(now)
  const lastRun = settings.lastRunAt

  if (elderEngine(settings.model) === 'claude') {
    const windowStart = lastOccurrence(nowD, settings.weekly.day, settings.weekly.at)
    if (nowD < windowStart) return null
    if (lastRun != null && lastRun >= windowStart.getTime()) return null
    if (quotaOk(quota, settings.weekly.maxWeekUsedPct)) return { kind: 'weekly' }
    const windowEnd = atTime(new Date(windowStart.getTime() + 86_400_000), `${SKIP_HOUR}:00`)
    return nowD > windowEnd ? { kind: 'skipped' } : null
  }

  const todayAt = atTime(nowD, settings.dailyAt)
  if (nowD >= todayAt && (lastRun == null || lastRun < todayAt.getTime())) return { kind: 'daily' }
  const finished = pending.find((p) => p.hasPendingFeedback && (p.archived || p.idleMs >= INACTIVE_MS))
  return finished ? { kind: 'conversation', sessionId: finished.id } : null
}
