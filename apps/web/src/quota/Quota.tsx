import { useEffect, useRef, useState } from 'react'
import type { Quota as QuotaData, QuotaReserve, QuotaReserveState, QuotaWindow } from '@sangha/shared'
import { api } from '../api'
import { useApp } from '../store'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Tone = 'ok' | 'warn' | 'danger'
const TONE_RANK: Record<Tone, number> = { ok: 0, warn: 1, danger: 2 }
const worse = (a: Tone, b: Tone): Tone => (TONE_RANK[a] >= TONE_RANK[b] ? a : b)

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

function Gauge({ label, w, reserve }: { label: string; w: QuotaWindow | null; reserve: QuotaReserveState | null }) {
  const pct = w ? Math.round(w.utilization * 100) : null
  let tone: Tone = pct == null ? 'ok' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok'
  // The line where the reserve starts to bite, as a percent of the bar: the top `reserve.pct` % of it.
  const line = reserve?.enabled ? 100 - reserve.pct : null
  if (pct != null && line != null) tone = worse(tone, pct >= line ? 'danger' : pct >= line - 10 ? 'warn' : 'ok')
  const reset = resetText(w)
  const reserveNote = line != null ? `, ${reserve!.pct} % gardés en réserve au-delà de ${line} %` : ''
  return (
    <div className={`quota-gauge quota-${tone}`} title={`${label} : ${pct ?? '?'} % du quota utilisé${reset ? `, ${reset}` : ''}${reserveNote}`}>
      <div className="quota-line">
        <span className="quota-label">{label}</span>
        <b className="quota-pct">{pct ?? '—'} %</b>
      </div>
      <div className="quota-bar" aria-hidden>
        <div className="quota-fill" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
        {line != null && reserve!.pct > 0 && (
          <>
            <div className="quota-reserve-zone" style={{ width: `${reserve!.pct}%` }} />
            <div className="quota-reserve-line" style={{ left: `${line}%` }} />
          </>
        )}
      </div>
      {reset && <div className="quota-reset">{reset}</div>}
    </div>
  )
}

const WINDOW_LABEL: Record<'fiveHour' | 'sevenDay', string> = { fiveHour: 'les 5 heures', sevenDay: 'la semaine' }

/** Shows only once the reserve itself has paused priests (a stricter, self-imposed cap hit ahead of the plan's own). */
function ReserveBadge({ reserve, quota }: { reserve: QuotaReserveState | null; quota: QuotaData | null }) {
  if (!reserve?.reached) return null
  const w = reserve.window === 'fiveHour' ? quota?.fiveHour ?? null : reserve.window === 'sevenDay' ? quota?.sevenDay ?? null : null
  const reset = resetText(w)
  const label = reserve.window ? WINDOW_LABEL[reserve.window] : null
  const title = `Réserve atteinte${label ? ` sur ${label}` : ''}${reset ? `, ${reset}` : ''} : les prêtres sont en pause jusqu'à ce que la fenêtre reparte.`
  return (
    <span className="quota-stop quota-reserve-stop" title={title}>
      Réserve atteinte — prêtres en pause
    </span>
  )
}

/** Toggle + slider popover anchored to the quota widget: what share of the quota stays untouched. */
function ReservePanel({ reserve }: { reserve: QuotaReserveState | null }) {
  const [enabled, setEnabled] = useState(reserve?.enabled ?? true)
  const [pct, setPct] = useState(reserve?.pct ?? 10)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The server may change it too (released once a window resets): follow it whenever we're not mid-edit.
  useEffect(() => {
    if (!reserve) return
    setEnabled(reserve.enabled)
    setPct(reserve.pct)
  }, [reserve?.enabled, reserve?.pct])

  const save = (partial: Partial<QuotaReserve>) => {
    api.saveQuotaReserve(partial).then(
      () => setError(null),
      (err) => setError(message(err)),
    )
  }

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // optimistic
    save({ enabled: next })
  }

  const setPctDebounced = (next: number) => {
    const clamped = Math.max(0, Math.min(50, Math.round(next)))
    setPct(clamped) // optimistic
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save({ pct: clamped }), 300)
  }

  return (
    <div className="quota-popover" role="dialog" aria-label="Réserve de quota">
      <header className="quota-popover-head">
        <h4 id="quota-reserve-label">Réserve</h4>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="quota-reserve-label"
          className={`mcp-switch ${enabled ? 'on' : ''}`}
          onClick={toggle}
        >
          <span className="mcp-switch-knob" aria-hidden />
        </button>
      </header>
      <div className="quota-popover-slider">
        <button type="button" className="icon-btn" disabled={!enabled || pct <= 0} aria-label="Réduire la réserve" onClick={() => setPctDebounced(pct - 1)}>
          −
        </button>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={pct}
          disabled={!enabled}
          onChange={(e) => setPctDebounced(Number(e.target.value))}
          aria-label="Pourcentage du quota gardé en réserve"
          aria-valuetext={`${pct} % gardés`}
        />
        <button type="button" className="icon-btn" disabled={!enabled || pct >= 50} aria-label="Augmenter la réserve" onClick={() => setPctDebounced(pct + 1)}>
          +
        </button>
      </div>
      <p className="quota-popover-pct">{pct} % gardés</p>
      <p className="muted small">
        {enabled
          ? `Au-delà de ${100 - pct} % utilisés, les prêtres sont mis en pause jusqu'à ce que la fenêtre reparte.`
          : 'Désactivée : les prêtres peuvent utiliser tout le quota.'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** The plan quota: the current 5-hour window and the week, each with how much is used and when it starts afresh.
 *  Click it to raise, lower or switch off the share kept in reserve. */
export function Quota() {
  const quota = useApp((s) => s.quota)
  const reserve = useApp((s) => s.reserve)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="quota" ref={wrapRef}>
      <button
        type="button"
        className={`quota-trigger ${open ? 'active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Quota de l'abonnement, régler la réserve"
        onClick={() => setOpen((o) => !o)}
      >
        {quota?.status === 'rejected' && <span className="quota-stop">Quota atteint</span>}
        <ReserveBadge reserve={reserve} quota={quota} />
        <Gauge label="Ces 5 heures" w={quota?.fiveHour ?? null} reserve={reserve} />
        <Gauge label="Cette semaine" w={quota?.sevenDay ?? null} reserve={reserve} />
      </button>
      {open && <ReservePanel reserve={reserve} />}
    </div>
  )
}
