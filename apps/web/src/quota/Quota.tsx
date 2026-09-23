import type { QuotaWindow } from '@sangha/shared'
import { useApp } from '../store'

/** When the window starts afresh: "dans 2 h 10" when close, else the day and hour. */
function resetText(w: QuotaWindow | null): string | null {
  if (!w?.resetsAt) return null
  const ms = w.resetsAt * 1000 - Date.now()
  if (ms <= 0) return 'repart maintenant'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `repart dans ${min} min`
  if (min < 12 * 60) return `repart dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return `repart ${new Date(w.resetsAt * 1000).toLocaleString('fr', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`
}

function Gauge({ label, w }: { label: string; w: QuotaWindow | null }) {
  const pct = w ? Math.round(w.utilization * 100) : null
  const tone = pct == null ? 'ok' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  const reset = resetText(w)
  return (
    <div className={`quota-gauge quota-${tone}`} title={`${label} : ${pct ?? '?'} % du quota utilisé${reset ? `, ${reset}` : ''}`}>
      <div className="quota-line">
        <span className="quota-label">{label}</span>
        <b className="quota-pct">{pct ?? '—'} %</b>
      </div>
      <div className="quota-bar" aria-hidden>
        <div className="quota-fill" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      {reset && <div className="quota-reset">{reset}</div>}
    </div>
  )
}

/** The plan quota: the current 5-hour window and the week, each with how much is used and when it starts afresh. */
export function Quota() {
  const quota = useApp((s) => s.quota)
  return (
    <div className="quota" aria-label="Quota de l'abonnement">
      {quota?.status === 'rejected' && <span className="quota-stop">Quota atteint</span>}
      <Gauge label="Ces 5 heures" w={quota?.fiveHour ?? null} />
      <Gauge label="Cette semaine" w={quota?.sevenDay ?? null} />
    </div>
  )
}
