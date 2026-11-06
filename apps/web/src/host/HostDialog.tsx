import type { HostMetric, HostSample, HostSuggestion } from '@sangha/shared'
import { openSession } from '../api'
import { Modal, ShellSnippet } from '../Dialogs'
import { formatAge, formatBytes, formatSince, PriestName, STATUS_LABEL } from '../priests'
import { useApp } from '../store'
import { LEVEL_COLOR } from './level'
import { SuggestionChat } from './SuggestionChat'

/** A metric's recent history (about 30 min), as a thin inline polyline: no chart lib needed for this. */
export function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null
  const w = 112
  const h = 26
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - Math.min(1, Math.max(0, v)) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="host-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <polyline points={points} fill="none" stroke={tone} strokeWidth={1.5} />
    </svg>
  )
}

/** One metric: its bar, its detail in words, a sparkline of its history, and how long it's stayed red. */
function Metric({ metric, history }: { metric: HostMetric; history: HostSample[] }) {
  const tone = LEVEL_COLOR[metric.level]
  const values = history.map((s) => s[metric.key])
  return (
    <div className="host-metric">
      <div className="host-metric-head">
        <span className="host-metric-label">{metric.label}</span>
        <b className="host-metric-pct" style={{ color: tone }}>
          {Math.round(metric.value * 100)} %
        </b>
      </div>
      <div className="host-metric-bar" aria-hidden>
        <div className="host-metric-fill" style={{ width: `${Math.min(100, metric.value * 100)}%`, background: tone }} />
      </div>
      <div className="host-metric-foot">
        <span className="muted small">{metric.detail}</span>
        <Sparkline values={values} tone={tone} />
      </div>
      {metric.redSince != null && <p className="host-metric-red">rouge {formatSince(metric.redSince)}</p>}
    </div>
  )
}

/** Something to do about a metric stuck red: what, why, the command to run yourself, and the priest it concerns (if any). */
function Suggestion({ s, onClose }: { s: HostSuggestion; onClose: () => void }) {
  const set = useApp((st) => st.set)
  const session = useApp((st) => (s.sessionId ? st.sessions[s.sessionId] : undefined))
  // The title or detail may already carry his note (written in from the server): no point saying it twice.
  const note = session?.note
  const noteAlreadyShown = !!note && (s.title.includes(note) || s.detail.includes(note))
  return (
    <li className="host-suggestion">
      <b>{s.title}</b>
      <p className="host-suggestion-detail">{s.detail}</p>
      {note && !noteAlreadyShown && (
        <p className="host-suggestion-note">
          Prêtre concerné : <PriestName note={note} title={session!.title} />
        </p>
      )}
      {s.command && <ShellSnippet title="À lancer toi-même : Sangha n'exécute jamais cette commande" text={s.command} />}
      {s.sessionId && (
        <div className="host-suggestion-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onClose()
              openSession(s.sessionId!)
            }}
          >
            Ouvrir le prêtre
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => set({ dialog: { kind: 'dismiss', id: s.sessionId! } })}>
            Congédier…
          </button>
        </div>
      )}
      <SuggestionChat suggestion={s} />
    </li>
  )
}

/**
 * The machine's full report: suggestions first (what's actionable), then every metric with its history,
 * then what's taking the room — heaviest processes, Docker containers, and worktrees with their priest
 * (or none: orphaned).
 */
export function HostDialog({ onClose }: { onClose: () => void }) {
  const host = useApp((s) => s.host)
  const sessions = useApp((s) => s.sessions)
  if (!host) return null // the chip that opens this dialog is itself hidden until a report lands

  return (
    <Modal title={`Machine — ${host.hostname}`} onClose={onClose}>
      <div className="form host-dialog">
        {host.inContainer && <p className="hint">Sangha tourne dans un conteneur : ces chiffres sont ceux de sa VM Docker, pas directement ceux de ta machine.</p>}

        {host.suggestions.length > 0 && (
          <section className="host-section">
            <h3>À faire</h3>
            <ul className="host-suggestions">
              {host.suggestions.map((s) => (
                <Suggestion key={s.id} s={s} onClose={onClose} />
              ))}
            </ul>
          </section>
        )}

        <section className="host-section">
          <h3>Métriques</h3>
          <div className="host-metrics">
            {host.metrics.map((m) => (
              <Metric key={m.key} metric={m} history={host.history} />
            ))}
          </div>
        </section>

        <section className="host-section">
          <h3>Processus les plus lourds</h3>
          {host.processes.length === 0 ? (
            <p className="hint">Rien à signaler.</p>
          ) : (
            <div className="md-table">
              <table>
                <thead>
                  <tr>
                    <th>Commande</th>
                    <th>CPU</th>
                    <th>RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {host.processes.map((p) => (
                    <tr key={p.pid}>
                      <td className="host-cmd" title={p.command}>
                        {p.command}
                      </td>
                      <td>{Math.round(p.cpu)} %</td>
                      <td>{formatBytes(p.rssBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="host-section">
          <h3>Conteneurs Docker</h3>
          {host.containers === null ? (
            <p className="hint">Docker indisponible.</p>
          ) : host.containers.length === 0 ? (
            <p className="hint">Aucun conteneur en cours.</p>
          ) : (
            <div className="md-table">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Image</th>
                    <th>CPU</th>
                    <th>RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {host.containers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="host-cmd" title={c.image}>
                        {c.image}
                      </td>
                      <td>{Math.round(c.cpu)} %</td>
                      <td>
                        {formatBytes(c.memBytes)} <span className="muted small">({Math.round(c.memPct)} %)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="host-section">
          <h3>
            Worktrees
            {host.worktreesSizedAt != null && <span className="muted small host-section-sub"> · pesés {formatAge(host.worktreesSizedAt)}</span>}
          </h3>
          {host.worktrees.length === 0 ? (
            <p className="hint">Aucun worktree.</p>
          ) : (
            <div className="md-table">
              <table>
                <thead>
                  <tr>
                    <th>Projet</th>
                    <th>Taille</th>
                    <th>Prêtre</th>
                  </tr>
                </thead>
                <tbody>
                  {host.worktrees.map((w) => (
                    <tr key={w.path}>
                      <td>
                        {w.project} / {w.name}
                      </td>
                      <td>{formatBytes(w.bytes)}</td>
                      <td>
                        {w.sessionId ? (
                          <>
                            {/* His note first: a worktree id or a first message means nothing — his note is
                                what tells you whether this is the one safe to clear out. */}
                            <PriestName note={sessions[w.sessionId]?.note} title={w.sessionTitle ?? ''} />{' '}
                            <span className="muted small">({w.status ? STATUS_LABEL[w.status] : '?'})</span>
                          </>
                        ) : (
                          <span className="muted small">aucun prêtre</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
