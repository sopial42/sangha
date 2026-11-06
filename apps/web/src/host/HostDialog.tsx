import { useState } from 'react'
import type { HostMetric, HostSample, HostSuggestion, HostWorktree, SessionSummary } from '@sangha/shared'
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

/**
 * The worktree a suggestion is about, when it is one of the disk ones (an idle priest's worktree, or an
 * orphan): matched by its id (`disk:worktree:<path>` / `disk:orphan:<path>`), else by its command when
 * it happens to be exactly the worktree's own removal command.
 */
function matchSuggestionWorktree(s: HostSuggestion, worktrees: HostWorktree[]): HostWorktree | undefined {
  const m = /^disk:(?:worktree|orphan):(.+)$/.exec(s.id)
  if (m) return worktrees.find((w) => w.path === m[1])
  return s.command ? worktrees.find((w) => w.removeCommand === s.command) : undefined
}

/** What a worktree is, in a sentence or two by a small model: quiet and in italics, a placeholder while it still thinks. */
function WorktreeComment({ comment }: { comment: string | null }) {
  return <p className="host-wt-comment">{comment ?? '✦ Haiku lit ce worktree…'}</p>
}

/**
 * Copies a worktree's removal command. Safe to delete: a plain "Copier la commande". Not: the same
 * command stays one click away, but behind an amber "Copier quand même" naming the blocker — the facts
 * are never hidden, only the risk is made visible.
 */
function WorktreeCopyButton({ w }: { w: HostWorktree }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(w.removeCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  return (
    <button
      type="button"
      className={`btn host-wt-copy ${w.removable ? 'btn-ghost' : 'btn-warn'} ${copied ? 'is-copied' : ''}`}
      onClick={copy}
      title={!w.removable && w.blocker ? w.blocker : undefined}
    >
      {copied ? 'Copié ✓' : w.removable ? 'Copier la commande' : 'Copier quand même'}
    </button>
  )
}

/**
 * Who a worktree belongs to, named like everywhere else a priest is (his note first, his title
 * alongside): a sub-agent's owner, or the worktree's own priest; none when it is an orphan. His note
 * comes from the live store when he's still in the courtyard (freshest), the report's own copy once he
 * isn't (nirvana, or the report just hasn't caught up yet).
 */
function WorktreeOwner({ w, sessions }: { w: HostWorktree; sessions: Record<string, Pick<SessionSummary, 'note'>> }) {
  if (w.kind === 'subagent' && w.owner) {
    const note = sessions[w.owner.sessionId]?.note ?? w.owner.note
    return <PriestName note={note} title={w.owner.title} />
  }
  if (w.sessionId) {
    const note = sessions[w.sessionId]?.note ?? w.sessionNote
    return (
      <>
        <PriestName note={note} title={w.sessionTitle ?? ''} />
        {w.status && <span className="muted small"> · {STATUS_LABEL[w.status]}</span>}
      </>
    )
  }
  return <span className="muted small">aucun prêtre</span>
}

/** The kind badge: what this worktree is, for the sub-agent one with its owner's note and whether he's still around. */
function worktreeKind(w: HostWorktree): { label: string; cls: string } {
  if (w.kind === 'orphan') return { label: 'orphelin', cls: 'host-wt-badge-orphan' }
  if (w.kind === 'priest') return { label: 'prêtre', cls: 'host-wt-badge-priest' }
  const owner = w.owner
  const who = owner ? owner.note ?? owner.title : ''
  let label = `sous-agent de « ${who} »`
  if (owner && !owner.alive) label += ' · au nirvana'
  else if (owner?.working) label += ' · travaille'
  return { label, cls: 'host-wt-badge-subagent' }
}

/** Small safety facts, in French, only the ones that apply: how much is uncommitted, unpushed, or in use. */
function worktreeFacts(w: HostWorktree): string[] {
  const facts: string[] = []
  if (w.dirty > 0) facts.push(`${w.dirty} modif${w.dirty > 1 ? 's' : ''}`)
  if (w.unpushed > 0) facts.push(`${w.unpushed} commit${w.unpushed > 1 ? 's' : ''} non poussé${w.unpushed > 1 ? 's' : ''}`)
  if (w.inUse) facts.push('utilisé')
  return facts
}

/** One worktree, as a readable row: what it is, whose it is, what a small model makes of it, and whether it's safe to clear. */
function WorktreeRow({ w, sessions }: { w: HostWorktree; sessions: Record<string, Pick<SessionSummary, 'note'>> }) {
  const badge = worktreeKind(w)
  const facts = worktreeFacts(w)
  return (
    <li className="host-wt-row">
      <div className="host-wt-top">
        <span className="host-wt-name">
          {w.project} / {w.name}
        </span>
        <span className="muted small host-wt-size">{formatBytes(w.bytes)}</span>
        <span className={`host-wt-badge ${badge.cls}`}>{badge.label}</span>
      </div>
      <div className="host-wt-owner">
        <WorktreeOwner w={w} sessions={sessions} />
      </div>
      <WorktreeComment comment={w.comment} />
      <div className="host-wt-safety">
        {w.removable ? <span className="host-wt-safe">✓ Supprimable sans rien perdre</span> : <span className="host-wt-blocker">{w.blocker ?? 'Non supprimable'}</span>}
        {facts.length > 0 && <span className="muted small">{facts.join(' · ')}</span>}
      </div>
      <div className="host-wt-actions">
        <WorktreeCopyButton w={w} />
      </div>
    </li>
  )
}

/** Something to do about a metric stuck red: what, why, the command to run yourself, and the priest it concerns (if any). */
function Suggestion({ s, wt, onClose }: { s: HostSuggestion; wt?: HostWorktree; onClose: () => void }) {
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
      {wt && (
        <div className="host-suggestion-wt">
          <WorktreeComment comment={wt.comment} />
          <WorktreeCopyButton w={wt} />
        </div>
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

  // Removable first (stable sort keeps each group in the report's own heaviest-first order), then the rest.
  const worktrees = [...host.worktrees].sort((a, b) => Number(b.removable) - Number(a.removable))
  const removable = worktrees.filter((w) => w.removable)
  const removableBytes = removable.reduce((sum, w) => sum + w.bytes, 0)

  return (
    <Modal title={`Machine — ${host.hostname}`} onClose={onClose}>
      <div className="form host-dialog">
        {host.inContainer && <p className="hint">Sangha tourne dans un conteneur : ces chiffres sont ceux de sa VM Docker, pas directement ceux de ta machine.</p>}

        {host.suggestions.length > 0 && (
          <section className="host-section">
            <h3>À faire</h3>
            <ul className="host-suggestions">
              {host.suggestions.map((s) => (
                <Suggestion key={s.id} s={s} wt={matchSuggestionWorktree(s, host.worktrees)} onClose={onClose} />
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
          {worktrees.length === 0 ? (
            <p className="hint">Aucun worktree.</p>
          ) : (
            <>
              {removable.length > 0 && (
                <p className="host-wt-count muted small">
                  {removable.length} supprimable{removable.length > 1 ? 's' : ''} · {formatBytes(removableBytes)} récupérables
                </p>
              )}
              <ul className="host-wt-list">
                {worktrees.map((w) => (
                  <WorktreeRow key={w.path} w={w} sessions={sessions} />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
