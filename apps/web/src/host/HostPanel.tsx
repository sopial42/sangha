import { useRef, useState, type PointerEvent } from 'react'
import { useApp } from '../store'
import { Sparkline } from './HostDialog'
import { LEVEL_COLOR, LEVEL_LABEL } from './level'

const KEY = 'sangha.hostPanel'
const MARGIN = 14

type Saved = { open: boolean; x: number; y: number }

function load(): Saved {
  try {
    return { open: true, x: MARGIN, y: MARGIN, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { open: true, x: MARGIN, y: MARGIN }
  }
}

/**
 * Home page, over the courtyard (top left at first): the machine's four gauges with their last half hour,
 * and what to do once one stays red. Dragged by its header anywhere in the courtyard; where it sits and
 * whether it is folded are remembered.
 */
export function HostPanel({ onOpen }: { onOpen: () => void }) {
  const host = useApp((s) => s.host)
  const [state, setState] = useState(load)
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  if (!host) return null

  const save = (next: Saved) => {
    localStorage.setItem(KEY, JSON.stringify(next))
    setState(next)
  }

  /** Keep it inside the courtyard, whatever the window's size. */
  const clamp = (x: number, y: number) => {
    const box = ref.current
    const parent = box?.offsetParent as HTMLElement | null
    if (!box || !parent) return { x, y }
    return {
      x: Math.max(0, Math.min(x, parent.clientWidth - box.offsetWidth)),
      y: Math.max(0, Math.min(y, parent.clientHeight - box.offsetHeight)),
    }
  }

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - state.x, dy: e.clientY - state.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return
    setState((s) => ({ ...s, ...clamp(e.clientX - drag.current!.dx, e.clientY - drag.current!.dy) }))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    save(state)
  }

  const { x, y } = clamp(state.x, state.y)
  const suggestion = host.suggestions[0]

  return (
    <aside ref={ref} className={`host-panel host-panel-${host.level}`} style={{ left: x, top: y }} aria-label="État de la machine">
      <div className="host-panel-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="Glisse pour déplacer">
        <span className="host-dot" style={{ background: LEVEL_COLOR[host.level] }} aria-hidden />
        <span>Machine · {LEVEL_LABEL[host.level]}</span>
        {host.suggestions.length > 0 && <span className="badge badge-live">{host.suggestions.length}</span>}
        <button
          type="button"
          className="host-panel-caret"
          onClick={() => save({ ...state, open: !state.open })}
          aria-expanded={state.open}
          title={state.open ? 'Replier' : 'Déplier'}
        >
          {state.open ? '▾' : '▸'}
        </button>
      </div>
      {state.open && (
        <div className="host-panel-body">
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
          {suggestion && (
            <p className="host-panel-suggestion">
              {suggestion.title}
              {host.suggestions.length > 1 && ` (+${host.suggestions.length - 1})`}
            </p>
          )}
          <button type="button" className={`btn ${suggestion ? 'btn-primary' : 'btn-ghost'} host-panel-see`} onClick={onOpen}>
            Voir le détail
          </button>
        </div>
      )}
    </aside>
  )
}
