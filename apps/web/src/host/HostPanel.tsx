import { useState } from 'react'
import { useApp } from '../store'
import { Sparkline } from './HostDialog'
import { LEVEL_COLOR, LEVEL_LABEL } from './level'

const KEY = 'sangha.hostPanel'

/**
 * Home page, bottom left of the courtyard: the machine's four gauges with their last half hour, always in
 * sight. Click opens the full report; the header folds it away (remembered).
 */
export function HostPanel({ onOpen }: { onOpen: () => void }) {
  const host = useApp((s) => s.host)
  const [open, setOpen] = useState(() => localStorage.getItem(KEY) !== 'closed')
  if (!host) return null
  const toggle = () => {
    localStorage.setItem(KEY, open ? 'closed' : 'open')
    setOpen(!open)
  }

  return (
    <aside className={`host-panel host-panel-${host.level}`} aria-label="État de la machine">
      <button type="button" className="host-panel-head" onClick={toggle} aria-expanded={open} title={open ? 'Replier' : 'Déplier'}>
        <span className="host-dot" style={{ background: LEVEL_COLOR[host.level] }} aria-hidden />
        <span>Machine · {LEVEL_LABEL[host.level]}</span>
        {host.suggestions.length > 0 && <span className="badge badge-live">{host.suggestions.length}</span>}
        <span className="host-panel-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <button type="button" className="host-panel-body" onClick={onOpen} title="Voir le rapport complet">
          {host.metrics.map((m) => {
            const tone = LEVEL_COLOR[m.level]
            return (
              <div key={m.key} className="host-panel-row" title={`${m.label} : ${m.detail}`}>
                <span className="host-panel-label">{m.label}</span>
                <Sparkline values={host.history.map((s) => s[m.key])} tone={tone} />
                <b className="host-panel-pct" style={{ color: tone }}>
                  {Math.round(m.value * 100)} %
                </b>
                <span className="host-panel-detail">{m.detail}</span>
              </div>
            )
          })}
        </button>
      )}
    </aside>
  )
}
