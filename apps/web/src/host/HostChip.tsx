import { useApp } from '../store'
import { LEVEL_COLOR, LEVEL_LABEL } from './level'

/** A metric's figure, compact: "CPU 42 %". Missing (not sampled yet): an em dash. */
const fig = (label: string, value: number | undefined) => `${label} ${value == null ? '—' : `${Math.round(value * 100)} %`}`

/**
 * Top bar, beside the quota: the host's health in one glance (CPU, RAM, swap, disk), a dot coloured by
 * the worst of them, and a badge once a metric has stayed red long enough to suggest something. Click
 * opens the full report. Hidden until the first sample lands.
 */
export function HostChip({ onOpen }: { onOpen: () => void }) {
  const host = useApp((s) => s.host)
  if (!host) return null
  const value = (key: string) => host.metrics.find((m) => m.key === key)?.value
  const title = `${host.hostname}${host.inContainer ? ' (conteneur Docker)' : ''} — ${LEVEL_LABEL[host.level]}\n${host.metrics.map((m) => `${m.label} : ${m.detail}`).join('\n')}`

  return (
    <button className="host-chip" onClick={onOpen} title={title}>
      <span className="host-dot" style={{ background: LEVEL_COLOR[host.level] }} aria-hidden />
      <span className="host-figs">
        {fig('CPU', value('cpu'))} · {fig('RAM', value('memory'))} · {fig('swap', value('swap'))} · {fig('disque', value('disk'))}
      </span>
      {host.suggestions.length > 0 && (
        <span className="badge badge-live host-chip-badge" aria-label={`${host.suggestions.length} suggestion(s)`}>
          {host.suggestions.length}
        </span>
      )}
    </button>
  )
}
