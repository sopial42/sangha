import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BUDDHA_SESSION_ID, modelKey, type BackgroundScript, type McpServer, type SessionSummary } from '@sangha/shared'
import { api, ApiError, closeSession, finishClose } from './api'
import { Chat } from './chat/Chat'
import { goToNeighbour } from './nav'
import { Md, MdInline } from './Md'
import {
  agentTitle,
  CONTEXT_COLOR,
  contextLevel,
  formatCost,
  formatSince,
  formatTime,
  formatTokens,
  PR_COLOR,
  PR_STATE_WORD,
  prFullLabel,
  robeOf,
  robeOfAgent,
  STATUS_LABEL,
} from './priests'
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

/** One background script, folded to its gist: Haiku's sentence first, the running time underneath,
 *  the raw command tucked away behind a disclosure so reading bash is never required. */
function ScriptItem({ script, now }: { script: BackgroundScript; now: number }) {
  return (
    <li className="script-item">
      <span className="script-dot" aria-hidden />
      <div className="script-body">
        <p className="script-summary">{script.summary ?? <span className="muted">Je regarde ce que fait ce script…</span>}</p>
        <p className="script-meta muted small">
          {formatSince(script.since, now)}
          <details className="script-command">
            <summary>voir la commande</summary>
            <code>{script.command}</code>
          </details>
        </p>
      </div>
    </li>
  )
}

const MCP_STATUS_LABEL: Record<McpServer['status'], string> = {
  connected: 'connecté',
  failed: 'en échec',
  'needs-auth': 'à authentifier',
  pending: 'connexion…',
  disabled: 'désactivé',
  off: 'non chargé',
}

// A server not currently loaded for this priest: the toggle reads "off" either way (switched off, or
// simply never loaded from the user's Claude config).
const mcpOff = (s: McpServer) => s.status === 'disabled' || s.status === 'off'

/**
 * The model he thinks with, changeable at any time: within Claude (or within OVH) from his next reply on;
 * Claude ↔ OVH relaunches him on the same conversation, which interrupts a turn in progress (asked first).
 */
function ModelPick({ session: s }: { session: SessionSummary }) {
  const models = useApp((st) => st.models)
  const [error, setError] = useState<string | null>(null)
  if (!models.length) return null
  const key = modelKey(s.engine, s.model)
  const current = models.some((m) => m.id === key) ? key : ''
  const change = (id: string) => {
    const next = models.find((m) => m.id === id)
    const relaunch = next && next.engine !== (s.engine ?? 'claude')
    if (relaunch && s.status === 'working' && !confirm('Changer de fournisseur le relance : son tour en cours sera interrompu. Continuer ?')) return
    api.setModel(s.id, id).then(
      () => setError(null),
      (e: Error) => setError(e.message),
    )
  }
  return (
    <select
      className={`model-pick ${s.engine && s.engine !== 'claude' ? 'ovh' : ''}`}
      value={current}
      onChange={(e) => change(e.target.value)}
      aria-label="Modèle de cette session"
      title={error ?? 'Modèle de cette session : change dès sa prochaine réponse (changer de fournisseur le relance)'}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Your standing instruction for him ("sois concis"…), recalled with each of your messages. Saved when you leave
 * the field or press Enter; Escape puts back what was saved.
 */
function ReminderBox({ id, saved }: { id: string; saved: string | null }) {
  const [text, setText] = useState(saved ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => setText(saved ?? ''), [saved])
  const save = () => {
    if (text.trim() !== (saved ?? '')) api.reminder(id, text.trim() || null).then(() => setFailed(false), () => setFailed(true))
  }
  return (
    <label
      className={`sv-reminder ${saved ? 'set' : ''} ${failed ? 'failed' : ''}`}
      title={failed ? 'Pas enregistré : le serveur a refusé (redémarré depuis ?)' : 'Ajouté à chacun de tes messages, sans apparaître dans la conversation'}
    >
      <span className="sv-reminder-label">Rappel</span>
      <input
        value={text}
        maxLength={500}
        placeholder="Consigne rappelée à chaque message, ex. : sois concis"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setText(saved ?? '')
          }
        }}
      />
    </label>
  )
}

/** One MCP server row: name (claude.ai and plugin ones get their own small tag), status, and its on/off switch. */
function McpRow({ server, busy, onToggle, onLogin }: { server: McpServer; busy: boolean; onToggle: () => void; onLogin: () => void }) {
  const claudeAi = server.name.startsWith('claude.ai ')
  const plugin = /^plugin:[^:]+:(.+)$/.exec(server.name)?.[1]
  const name = claudeAi ? server.name.slice('claude.ai '.length) : (plugin ?? server.name)
  const on = !mcpOff(server)
  return (
    <li className="mcp-row">
      <span className="mcp-name" title={`Portée : ${server.scope}`}>
        {name}
        {claudeAi && <span className="mcp-tag">claude.ai</span>}
        {plugin && <span className="mcp-tag">plugin</span>}
      </span>
      {server.status === 'needs-auth' ? (
        // Opens your browser on its sign-in page; the row stays busy until you authorized there.
        <button type="button" className="mcp-login" onClick={onLogin} disabled={busy} title="Ouvre la page de connexion dans ton navigateur">
          <span className="mcp-dot" aria-hidden />
          {busy ? 'autorise dans le navigateur…' : 'Se connecter'}
        </button>
      ) : (
        <span className={`mcp-status mcp-status-${server.status}`} title={server.error}>
          <span className="mcp-dot" aria-hidden />
          {MCP_STATUS_LABEL[server.status]}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? 'Désactiver' : 'Activer'} ${server.name}`}
        className={`mcp-switch ${on ? 'on' : ''}`}
        disabled={busy}
        onClick={onToggle}
      >
        <span className="mcp-switch-knob" aria-hidden />
      </button>
    </li>
  )
}

/**
 * 🔌 button in the session header: a compact popover over the priest's MCP servers, lazily fetched
 * (waking his process) on first open, with a per-row toggle that swaps the whole list in from the
 * backend once it answers. Closed and reopened freely; only a session change or ↻ refetches.
 */
function McpPanel({ sessionId, open, onToggleOpen, onClose }: { sessionId: string; open: boolean; onToggleOpen: () => void; onClose: () => void }) {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // name of the server mid-toggle, if any
  const wrapRef = useRef<HTMLDivElement>(null)

  // A different priest: forget what we knew, fetch fresh next time the popover opens.
  useEffect(() => {
    setServers(null)
    setError(null)
    setBusy(null)
  }, [sessionId])

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .mcpServers(sessionId)
      .then(setServers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Impossible de joindre le prêtre.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open && servers === null && !loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId])

  // A click outside the button or the popover closes it, same as any other dropdown.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  const toggle = (server: McpServer) => {
    setBusy(server.name)
    setError(null)
    api
      .setMcpServer(sessionId, server.name, mcpOff(server))
      .then(setServers)
      .catch((e) => setError(e instanceof ApiError ? e.message : `Impossible de changer ${server.name}.`))
      .finally(() => setBusy(null))
  }

  const login = (server: McpServer) => {
    setBusy(server.name)
    setError(null)
    api
      .loginMcpServer(sessionId, server.name)
      .then(setServers)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : `Impossible de se connecter à ${server.name}.`)
        // The sign-in may have worked even if he cannot reach it yet: show where it stands now.
        api.mcpServers(sessionId).then(setServers, () => undefined)
      })
      .finally(() => setBusy(null))
  }

  // Enabled ones first; stable sort keeps the backend's own order inside each group.
  const sorted = servers ? [...servers].sort((a, b) => Number(mcpOff(a)) - Number(mcpOff(b))) : null

  return (
    <div className="mcp-control" ref={wrapRef}>
      <button className={`btn btn-ghost ${open ? 'active' : ''}`} aria-haspopup="true" aria-expanded={open} title="Serveurs MCP" onClick={onToggleOpen}>
        MCP
      </button>
      {open && (
        <div className="mcp-popover" role="menu" aria-label="Serveurs MCP">
          <header className="mcp-popover-head">
            <h4>Serveurs MCP</h4>
            <button type="button" className="text-link" onClick={load} disabled={loading}>
              {loading ? 'Rafraîchissement…' : 'Rafraîchir'}
            </button>
          </header>
          {loading && !sorted && <p className="muted small">Je réveille le prêtre…</p>}
          {error && <p className="mcp-error">{error}</p>}
          {sorted && sorted.length === 0 && <p className="muted small">Aucun serveur MCP.</p>}
          {sorted && sorted.length > 0 && (
            <ul className="mcp-list">
              {sorted.map((server) => (
                <McpRow key={server.name} server={server} busy={busy === server.name} onToggle={() => toggle(server)} onLogin={() => login(server)} />
              ))}
            </ul>
          )}
          <p className="muted small mcp-footnote">Réglage gardé pour les prochains prêtres de ce projet.</p>
        </div>
      )}
    </div>
  )
}

// The novices panel, folded away or not: one choice for every session, remembered across reloads.
const NOVICES_CLOSED_KEY = 'sangha.novicesClosed'

/** A session, almost full screen: its conversation, where it stands, and its novices on the right. */
export function SessionView() {
  const { sessions, projects, selectedId, selectedMonk, view, dialog, closing, set } = useApp()
  const live = selectedId ? sessions[selectedId] : undefined
  // A close in flight keeps `selectedId` around so the panel can keep rendering while it shrinks
  // toward him — even if, meanwhile, he's actually gone (dismissed): the last thing we knew of him.
  const lastRef = useRef<SessionSummary | undefined>(undefined)
  if (live) lastRef.current = live
  const s = live ?? (closing?.id === selectedId ? lastRef.current : undefined)
  const [novicesClosed, setNovicesClosed] = useState(() => localStorage.getItem(NOVICES_CLOSED_KEY) === '1')
  const foldNovices = (close: boolean) => {
    localStorage.setItem(NOVICES_CLOSED_KEY, close ? '1' : '0')
    setNovicesClosed(close)
  }

  // Where the panel shrinks to: computed once, right as the close starts, from his on-screen spot
  // already captured in `closing.target`. Falls back to a plain shrink-and-fade in place.
  const panelRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [exit, setExit] = useState<{ x: number; y: number; scale: number } | null>(null)
  useLayoutEffect(() => {
    if (!closing) return
    const panel = panelRef.current
    if (!panel || !closing.target || reducedMotion) {
      setExit({ x: 0, y: 0, scale: reducedMotion ? 1 : 0.85 })
      return
    }
    const rect = panel.getBoundingClientRect()
    setExit({ x: closing.target.x - (rect.left + rect.width / 2), y: closing.target.y - (rect.top + rect.height / 2), scale: 0.08 })
  }, [closing, reducedMotion])

  // Looking at a priest who stopped counts as having read him.
  useEffect(() => {
    if (!s || s.status !== 'waiting') return
    const markSeen = () => document.visibilityState === 'visible' && void api.seen(s.id)
    markSeen()
    document.addEventListener('visibilitychange', markSeen)
    return () => document.removeEventListener('visibilitychange', markSeen)
  }, [s?.id, s?.status])

  // The MCP popover: Escape closes it first, same as any dropdown would, before it closes the panel.
  const [mcpOpen, setMcpOpen] = useState(false)
  useEffect(() => setMcpOpen(false), [s?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mcpOpen) return setMcpOpen(false)
      if (!dialog) closeSession()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, mcpOpen])

  // Keeps "depuis Xmin" under running scripts fresh, without a tick running when there is nothing to age.
  const [now, setNow] = useState(() => Date.now())
  const scriptCount = s?.scripts.length ?? 0
  useEffect(() => {
    if (!scriptCount) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [scriptCount])

  if (!s) return null
  const isBuddha = s.id === BUDDHA_SESSION_ID
  const title = agentTitle(s, projects)
  const novices = view.monkOrder.map((id) => view.monks[id]!).filter(Boolean)
  const scripts = s.scripts
  const hasColumn = scripts.length > 0 || novices.length > 0
  const columnLabel =
    scripts.length > 0 && novices.length > 0
      ? `Scripts & sous-agents (${scripts.length + novices.length})`
      : scripts.length > 0
        ? `Scripts en cours (${scripts.length})`
        : `Sous-agents (${novices.length})`

  const closeDuration = reducedMotion ? 0.18 : 0.4
  return (
    <motion.div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && closeSession()}
      initial={false}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={{ duration: closing ? closeDuration : 0.15, ease: closing ? 'easeIn' : 'easeOut' }}
      style={{ pointerEvents: closing ? 'none' : 'auto' }}
    >
      <motion.div
        ref={panelRef}
        className="session-view"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-title"
        initial={false}
        animate={closing && exit ? { x: exit.x, y: exit.y, scale: exit.scale, opacity: 0 } : { x: 0, y: 0, scale: 1, opacity: 1 }}
        transition={{ duration: closing ? closeDuration : 0.15, ease: closing ? 'easeIn' : 'easeOut' }}
        onAnimationComplete={() => closing && finishClose(closing.id)}
        style={{ pointerEvents: closing ? 'none' : 'auto' }}
      >
        <header className="sv-head">
          <span className="robe-dot" style={{ background: isBuddha ? 'var(--gold)' : robeOfAgent(s.agent) }} aria-hidden />
          <div className="sv-id">
            <h2 id="sv-title">{isBuddha ? 'Bouddha' : s.title}</h2>
            {/* His note: what he is about, read right under his title. */}
            {!isBuddha && (
              <p className={`sv-note ${s.note ? 'has-note' : 'muted small'}`}>
                {s.note ? (
                  <>
                    {s.note}{' '}
                    <button type="button" className="text-link" onClick={() => set({ dialog: { kind: 'note', id: s.id } })}>
                      modifier
                    </button>
                  </>
                ) : (
                  <button type="button" className="text-link" onClick={() => set({ dialog: { kind: 'note', id: s.id } })}>
                    + ajouter une note
                  </button>
                )}
              </p>
            )}
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
                  {(s.pr?.branch ?? s.branch) && (
                    <>
                      {' · '}
                      <code>⎇ {s.pr?.branch ?? s.branch}</code>
                    </>
                  )}
                  {s.pr && (
                    <>
                      {' '}
                      <a
                        className="pr-chip-link"
                        href={s.pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={prFullLabel(s.pr)}
                        style={{ color: PR_COLOR[s.pr.state], borderColor: PR_COLOR[s.pr.state] }}
                      >
                        PR #{s.pr.number} · {PR_STATE_WORD[s.pr.state]}
                      </a>
                    </>
                  )}
                  {s.external && ' · ⌨ lancée hors de Sangha'}
                </>
              )}
            </p>
            <div className="sv-tags">
              <span className={`status status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
              {!isBuddha && !s.external && <ModelPick session={s} />}
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
            </div>
          </div>
          <div className="sv-act-col">
            {!isBuddha && <ReminderBox key={s.id} id={s.id} saved={s.reminder} />}
            <div className="sv-actions">
              {!isBuddha && (!s.external || s.alive) && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    // Confiding opens a window for the context to hand over; taking him back is immediate.
                    !s.shepherd || s.shepherd.state === 'refused' ? set({ dialog: { kind: 'shepherd', id: s.id } }) : void api.shepherd(s.id, false)
                  }
                  title={
                    s.shepherd && s.shepherd.state !== 'refused'
                      ? 'Bouddha arrête de le suivre'
                      : 'Bouddha lui fera prendre une session neuve au moment qui lui convient, sans jamais l’interrompre, jusqu’à ce que ce soit fait'
                  }
                >
                  {s.shepherd && s.shepherd.state !== 'refused' ? 'Reprendre à Bouddha' : 'Confier à Bouddha'}
                </button>
              )}
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
              {!isBuddha && !s.external && (
                <button
                  className={`btn btn-ghost ${Object.keys(s.env).length ? 'active' : ''}`}
                  onClick={() => set({ dialog: { kind: 'env', id: s.id } })}
                  title="Ses variables d'environnement, propres à cette session"
                >
                  Env{Object.keys(s.env).length ? ` · ${Object.keys(s.env).length}` : ''}
                </button>
              )}
              {!isBuddha && !s.external && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (s.status === 'working' && !confirm('Il travaille : relancer interrompt son tour en cours. Relancer quand même ?')) return
                    void api.restart(s.id)
                  }}
                  title="Relancer la session : même conversation, mais il relit son agent, ses outils et ses MCP"
                >
                  Relancer
                </button>
              )}
              {!isBuddha && !s.external && (
                <McpPanel sessionId={s.id} open={mcpOpen} onToggleOpen={() => setMcpOpen((o) => !o)} onClose={() => setMcpOpen(false)} />
              )}
            </div>
          </div>
          <div className="sv-nav">
            <a
              className="icon-btn big sv-newtab"
              href={`/?session=${encodeURIComponent(s.id)}`}
              target="_blank"
              rel="noopener"
              aria-label="Ouvrir cette conversation dans un nouvel onglet"
              title="Ouvrir dans un nouvel onglet"
            >
              ↗
            </a>
            <button className="icon-btn big" onClick={() => goToNeighbour(-1)} aria-label="Moine précédent (←)" title="Moine précédent (←) · les silencieux sont sautés">
              ‹
            </button>
            <button className="icon-btn big" onClick={() => goToNeighbour(1)} aria-label="Moine suivant (→)" title="Moine suivant (→) · les silencieux sont sautés">
              ›
            </button>
            <button className="icon-btn big" onClick={closeSession} aria-label="Fermer (Échap)" title="Fermer (Échap)">
              ✕
            </button>
          </div>
        </header>

        <div className={`sv-body ${hasColumn ? (novicesClosed ? 'novices-closed' : '') : 'no-novices'}`}>
          <div className="sv-main">
            {!isBuddha && <ProgressCard session={s} />}
            <Chat author={isBuddha ? 'Bouddha' : title} external={s.external ? { alive: s.alive } : null} />
          </div>
          {hasColumn && novicesClosed && (
            <button className="sv-novices-reopen" onClick={() => foldNovices(false)} title={`Afficher ${columnLabel}`} aria-label={`Afficher ${columnLabel}`}>
              ‹ {columnLabel}
            </button>
          )}
          {hasColumn && !novicesClosed && (
            <aside className="sv-novices" aria-label="Scripts et sous-agents">
              {scripts.length > 0 && (
                <>
                  <header className="sv-novices-head">
                    <h3>
                      Scripts en cours <span className="muted">({scripts.length})</span>
                    </h3>
                    <button className="icon-btn" onClick={() => foldNovices(true)} aria-label={`Masquer ${columnLabel}`} title={`Masquer ${columnLabel}`}>
                      ×
                    </button>
                  </header>
                  <ul className="scripts-list">
                    {scripts.map((script) => (
                      <ScriptItem key={script.id} script={script} now={now} />
                    ))}
                  </ul>
                </>
              )}
              {novices.length > 0 && (
                <>
                  <header className="sv-novices-head">
                    <h3>
                      Sous-agents <span className="muted">({novices.length})</span>
                    </h3>
                    {scripts.length === 0 && (
                      <button className="icon-btn" onClick={() => foldNovices(true)} aria-label={`Masquer ${columnLabel}`} title={`Masquer ${columnLabel}`}>
                        ×
                      </button>
                    )}
                  </header>
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
                </>
              )}
            </aside>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
