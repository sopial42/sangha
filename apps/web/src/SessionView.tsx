import { useEffect, useRef, useState } from 'react'
import { BUDDHA_SESSION_ID, type SessionSummary } from '@sangha/shared'
import { api, closeSession } from './api'
import { Chat } from './chat/Chat'
import { Md, MdInline } from './Md'
import { agentTitle, CONTEXT_COLOR, contextLevel, formatCost, formatTime, formatTokens, robeOf, robeOfAgent, STATUS_LABEL } from './priests'
import { profileFor, toolIcon } from './profiles'
import { useApp, type LogItem, type MonkInstance } from './store'

type Progress = { goal: string; state: string; next: string }

/**
 * Where the session stands. Shown at once from the recap already known (the one above his head in the
 * courtyard); a fuller point from Haiku replaces it quietly when ready.
 */
// Closed cards, per session, remembered across reloads.
const CLOSED_KEY = 'sangha.progressClosed'
const closedCards = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function ProgressCard({ session }: { session: SessionSummary }) {
  const [data, setData] = useState<Progress | null>(null)
  const [loading, setLoading] = useState(false)
  const [closed, setClosed] = useState(() => closedCards().includes(session.id))
  useEffect(() => setClosed(closedCards().includes(session.id)), [session.id])
  const toggle = (close: boolean) => {
    const others = closedCards().filter((id) => id !== session.id)
    localStorage.setItem(CLOSED_KEY, JSON.stringify(close ? [...others, session.id].slice(-200) : others))
    setClosed(close)
  }

  const load = (fresh = false) => {
    setLoading(true)
    fetch(`/api/sessions/${session.id}/progress${fresh ? '?fresh=1' : ''}`)
      .then((r) => r.json() as Promise<{ progress: Progress | null }>)
      .then((r) => r.progress && setData(r.progress))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

  // On open, and again each time he stops working.
  useEffect(() => {
    if (!closed) load()
  }, [session.id, session.status === 'working', closed])

  const shown: Progress | null =
    data ??
    (session.recap
      ? { goal: session.title, state: session.recap.done, next: session.recap.next }
      : session.doing
        ? { goal: session.title, state: session.doing, next: 'Il y travaille.' }
        : null)

  if (closed)
    return (
      <button className="progress-reopen" onClick={() => toggle(false)} title="Rouvrir le point sur cette session">
        Où il en est ▾
      </button>
    )

  return (
    <section className="progress" aria-live="polite" aria-busy={loading}>
      <header>
        <h3>Où il en est</h3>
        <span className="progress-actions">
          <button className={`icon-btn ${loading ? 'spinning' : ''}`} onClick={() => load(true)} disabled={loading} aria-label="Refaire le point" title="Refaire le point">
            ↻
          </button>
          <button className="icon-btn" onClick={() => toggle(true)} aria-label="Fermer" title="Fermer">
            ×
          </button>
        </span>
      </header>
      {!shown && <p className="muted">{loading ? 'Je fais le point…' : 'Pas encore de point pour cette session.'}</p>}
      {shown && (
        <div className="progress-grid">
          <p>
            <b>Tâche</b> <MdInline text={shown.goal} />
          </p>
          <p>
            <b>Avancement</b> <MdInline text={shown.state} />
          </p>
          <p className="progress-next">
            <b>Reste</b> <MdInline text={shown.next} />
          </p>
        </div>
      )}
    </section>
  )
}

const STATUS: Record<string, string> = { working: 'au travail', completed: 'terminé', failed: 'échec', stopped: 'arrêté' }

/** One novice, folded to a line, unfolded to his whole thread (read-only). */
function Novice({ m, sessionId, external, open, onToggle }: { m: MonkInstance; sessionId: string; external: boolean; open: boolean; onToggle: () => void }) {
  const profiles = useApp((s) => s.profiles)
  const p = profileFor(m.agentType, profiles)
  const ref = useRef<HTMLLIElement>(null)
  const [log, setLog] = useState<LogItem[]>(m.log)

  // Sangha's novices stream with their priest; an outside session's are read from their own transcript.
  useEffect(() => {
    if (!external) return setLog(m.log)
    if (!open) return
    let alive = true
    const fetchLog = () =>
      fetch(`/api/sessions/${sessionId}/novices/${m.monkId}/log`)
        .then((r) => r.json() as Promise<{ log: LogItem[] }>)
        .then((r) => alive && setLog(r.log))
        .catch(() => undefined)
    void fetchLog()
    const t = m.status === 'working' ? setInterval(fetchLog, 5000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [external, open, m.log, m.status, m.monkId, sessionId])

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  return (
    <li ref={ref} className={`novice-item ${open ? 'open' : ''}`}>
      <button className="novice-head" onClick={onToggle} aria-expanded={open}>
        <span className="robe-dot small-dot" style={{ background: p.robe }} aria-hidden />
        <span className="novice-id">
          <b>{p.name === m.agentType ? m.agentType : `${p.name} · ${m.agentType}`}</b>
          <span className="muted small">{m.description}</span>
        </span>
        <span className={`status status-${m.status}`}>{STATUS[m.status]}</span>
      </button>
      {open && (
        <div className="novice-body">
          {m.prompt && (
            <details>
              <summary>Mission</summary>
              <div className="drawer-text">
                <Md text={m.prompt} />
              </div>
            </details>
          )}
          <ol className="log">
            {log.length === 0 && <li className="muted">En silence…</li>}
            {log.map((l, i) =>
              l.kind === 'tool' ? (
                <li key={i} className="log-tool">
                  {l.at > 0 && <time className="msg-time">{formatTime(l.at)}</time>}
                  {toolIcon(l.tool)} <b>{l.tool}</b> <span className="muted">{l.summary}</span>
                </li>
              ) : (
                <li key={i} className="log-text">
                  {l.at > 0 && <time className="msg-time">{formatTime(l.at)}</time>}
                  <Md text={l.text} />
                </li>
              ),
            )}
          </ol>
          {m.summary && (
            <>
              <h4>Rapport</h4>
              <div className="drawer-text">
                <Md text={m.summary} />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

/** A session, almost full screen: its conversation, where it stands, and its novices on the right. */
export function SessionView() {
  const { sessions, projects, selectedId, selectedMonk, view, dialog, set } = useApp()
  const s = selectedId ? sessions[selectedId] : undefined

  // Looking at a priest who stopped counts as having read him.
  useEffect(() => {
    if (!s || s.status !== 'waiting') return
    const markSeen = () => document.visibilityState === 'visible' && void api.seen(s.id)
    markSeen()
    document.addEventListener('visibilitychange', markSeen)
    return () => document.removeEventListener('visibilitychange', markSeen)
  }, [s?.id, s?.status])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && closeSession()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  if (!s) return null
  const isBuddha = s.id === BUDDHA_SESSION_ID
  const title = agentTitle(s, projects)
  const novices = view.monkOrder.map((id) => view.monks[id]!).filter(Boolean)

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && closeSession()}>
      <div className="session-view" role="dialog" aria-modal="true" aria-labelledby="sv-title">
        <header className="sv-head">
          <span className="robe-dot" style={{ background: isBuddha ? 'var(--gold)' : robeOfAgent(s.agent) }} aria-hidden />
          <div className="sv-id">
            <h2 id="sv-title">{isBuddha ? 'Bouddha' : s.title}</h2>
            <p className="muted small">
              {isBuddha ? (
                'Demande-lui tout : il lance et suit les prêtres'
              ) : (
                <>
                  <b>{title}</b>
                  {' · '}
                  <span className="project-tag" style={{ borderColor: robeOf(s.project, projects) }}>
                    {s.project}
                  </span>
                  {s.branch && (
                    <>
                      {' · '}
                      <code>⎇ {s.branch}</code>
                    </>
                  )}
                  {s.external && ' · ⌨ lancée hors de Sangha'}
                </>
              )}
            </p>
          </div>
          <div className="sv-actions">
            {s.context != null && (
              <span className="context-chip" style={{ color: CONTEXT_COLOR[contextLevel(s.context)!] }} title="Taille du contexte de la session">
                Contexte {formatTokens(s.context)}
                {s.renewal === 'asked' ? ' · session neuve proposée' : s.renewal === 'postponed' ? ' · reportée' : ''}
              </span>
            )}
            {s.cost != null && s.cost >= 0.01 && (
              <span className="context-chip" title="Ce qu'aurait coûté cette session au prix de l'API, sous-agents et sessions précédentes compris. Elle tourne sur ton abonnement.">
                {formatCost(s.cost)}
              </span>
            )}
            {s.shepherd && (
              <span className="context-chip shepherd-chip" title={s.shepherd.note ? `Sa dernière réponse : ${s.shepherd.note}` : undefined}>
                ☸{' '}
                {s.shepherd.state === 'asked'
                  ? 'Bouddha attend sa réponse'
                  : s.shepherd.state === 'refused'
                    ? 'a refusé de repartir à neuf'
                    : s.shepherd.nextAt > Date.now()
                      ? `Bouddha revient à ${formatTime(s.shepherd.nextAt)}`
                      : 'Bouddha lui demandera dès qu’il s’arrête'}
              </span>
            )}
            {!isBuddha && (!s.external || s.alive) && (
              <button
                className="btn btn-ghost"
                onClick={() => void api.shepherd(s.id, !s.shepherd || s.shepherd.state === 'refused')}
                title={
                  s.shepherd && s.shepherd.state !== 'refused'
                    ? 'Bouddha arrête de le suivre'
                    : 'Bouddha lui fera prendre une session neuve au moment qui lui convient, sans jamais l’interrompre, jusqu’à ce que ce soit fait'
                }
              >
                {s.shepherd && s.shepherd.state !== 'refused' ? 'Reprendre à Bouddha' : 'Confier à Bouddha'}
              </button>
            )}
            {!isBuddha && (!s.shepherd || s.shepherd.state === 'refused') && s.status !== 'working' && s.renewal !== 'asked' && (!s.external || s.alive) && (
              <button className="btn btn-ghost" onClick={() => void api.renew(s.id)} title="Lui proposer de continuer dans une session neuve, avec une passation">
                Repartir à neuf
              </button>
            )}
            <span className={`status status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
            {s.status === 'interrupted' && (
              <button className="btn btn-primary" onClick={() => void api.resume(s.id)}>
                Reprendre
              </button>
            )}
            {!isBuddha && !s.external && (
              <button className="btn btn-ghost" onClick={() => set({ dialog: { kind: 'dismiss', id: s.id } })}>
                Envoyer au nirvana
              </button>
            )}
            <button className="icon-btn big" onClick={closeSession} aria-label="Fermer (Échap)" title="Fermer (Échap)">
              ✕
            </button>
          </div>
        </header>

        <div className={`sv-body ${novices.length ? '' : 'no-novices'}`}>
          <div className="sv-main">
            {!isBuddha && <ProgressCard session={s} />}
            <Chat author={isBuddha ? 'Bouddha' : title} external={s.external ? { alive: s.alive } : null} />
          </div>
          {novices.length > 0 && (
            <aside className="sv-novices" aria-label="Sous-agents">
              <h3>
                Sous-agents <span className="muted">({novices.length})</span>
              </h3>
              <ul>
                {[...novices].reverse().map((m) => (
                  <Novice
                    key={m.monkId}
                    m={m}
                    sessionId={s.id}
                    external={s.external}
                    open={selectedMonk === m.monkId}
                    onToggle={() => set({ selectedMonk: selectedMonk === m.monkId ? null : m.monkId })}
                  />
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
