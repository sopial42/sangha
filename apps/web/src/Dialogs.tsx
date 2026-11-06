import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { providerEnv, shellExports, type CostReport, type ElderSettingsPatch, type ElderState, type ElderTopic, type ElderTopicStatus, type GlobalMcp, type LibraryMcp, type NirvanaEntry, type NirvanaSearchResult, type ProjectSuggestion, type Provider, envText, parseEnvText } from '@sangha/shared'
import { ApiError, api, lotusFailure, openSession } from './api'
import { agentTitle, formatCost, formatTime, priestLabel, PriestName, robeOf, robeOfAgent } from './priests'
import { useApp } from './store'
import { useBackdropClose } from './backdrop'
import { draftOf, NEW_PRIEST_DRAFT, saveDraft } from './drafts'
import { HostDialog } from './host/HostDialog'

/** Native modal <dialog>: focus trap, Escape and backdrop come for free. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(onClose)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="modal" onClose={onClose} {...backdrop} aria-labelledby="modal-title">
      <div className="modal-body">
        <header className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function NewSession({ project: initial, onClose }: { project?: string; onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const [project, setProject] = useState(initial ?? projects[0]?.name ?? '')
  const p = projects.find((x) => x.name === project)
  const [agent, setAgent] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [baseRef, setBaseRef] = useState('')
  const models = useApp((s) => s.models)
  const defaultModel = useApp((s) => s.defaultModel)
  const [model, setModel] = useState(defaultModel)
  const [prompt, setPrompt] = useState(() => draftOf(NEW_PRIEST_DRAFT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Default to the project's own team lead when it ships one, else Sangha's.
    setAgent(p?.agents.find((a) => a.source === 'project' && /lead/i.test(a.id))?.id ?? 'lead')
    setBaseRef(p?.branch ?? '')
    setBranches([])
    if (p?.isGit) api.branches(p.name).then(setBranches, () => undefined)
  }, [p])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = await api.createSession({ project, agent, prompt, baseRef: baseRef || undefined, model: models.some((m) => m.id === model) ? model : '' })
      saveDraft(NEW_PRIEST_DRAFT, '')
      onClose()
      openSession(s.id)
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Nouvelle session" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Projet
          <select value={project} onChange={(e) => setProject(e.target.value)} required>
            {projects.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Prêtre</legend>
          <div className="agent-grid">
            {p?.agents.map((a) => (
              <label key={a.id} className={`agent-card ${agent === a.id ? 'active' : ''}`}>
                <input type="radio" name="agent" value={a.id} checked={agent === a.id} onChange={() => setAgent(a.id)} />
                <span className="agent-title">
                  {a.title}
                  {a.source === 'project' && <span className="badge">projet</span>}
                </span>
                <span className="agent-desc">{a.description || a.id}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {p?.isGit && (
          <label>
            Partir de la branche
            <select value={baseRef} onChange={(e) => setBaseRef(e.target.value)}>
              {(branches.length ? branches : [p.branch ?? 'HEAD']).map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <span className="hint">Le prêtre travaille dans son propre worktree, sur une branche sangha/…</span>
          </label>
        )}
        {models.length > 0 && (
          <label>
            Modèle
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            {models.find((x) => x.id === model)?.engine !== 'claude' && (
              <span className="hint">Hors de ton abonnement Claude : ni quota consommé ni coût affiché.</span>
            )}
          </label>
        )}
        <label>
          Consigne
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              saveDraft(NEW_PRIEST_DRAFT, e.target.value)
            }}
            rows={5} required placeholder="Que doit faire ce prêtre ?" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || !agent || !prompt.trim()}>
            {busy ? 'Ouverture…' : 'Lancer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AddProject({ onClose }: { onClose: () => void }) {
  const set = useApp((s) => s.set)
  const [mode, setMode] = useState<'local' | 'git'>('local')
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [found, setFound] = useState<ProjectSuggestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.suggestions().then(setFound, () => setFound([]))
  }, [])

  const add = async (src: { gitUrl: string } | { path: string }) => {
    setBusy(true)
    setError(null)
    try {
      await api.addProject(src, name || undefined)
      set({ projects: await api.projects() })
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Ajouter un projet" onClose={onClose}>
      <div className="form">
        <div className="segmented" role="tablist" aria-label="Source du projet">
          <button role="tab" aria-selected={mode === 'local'} className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
            Dossier sur cette machine
          </button>
          <button role="tab" aria-selected={mode === 'git'} className={mode === 'git' ? 'active' : ''} onClick={() => setMode('git')}>
            Cloner un repo git
          </button>
        </div>

        {mode === 'local' && (
          <section className="suggestions" aria-label="Repos détectés">
            <p className="hint">Repos où Claude Code a tourné ces 14 derniers jours :</p>
            {found === null && <p className="hint">Recherche…</p>}
            {found?.length === 0 && <p className="hint">Aucun repo détecté.</p>}
            <ul>
              {found?.map((f) => (
                <li key={f.path}>
                  <button className="suggestion" disabled={busy} onClick={() => void add({ path: f.path })}>
                    <b>{f.name}</b>
                    <span>{f.path}</span>
                    <span className="muted small">{new Date(f.lastUsed).toLocaleDateString('fr', { day: 'numeric', month: 'short' })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void add(mode === 'local' ? { path: source } : { gitUrl: source })
          }}
        >
          <label>
            {mode === 'local' ? 'Ou un chemin' : 'URL du repo git'}
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              required
              placeholder={mode === 'local' ? '~/42/nova-notaria/Robia' : 'git@github.com:moi/robia.git'}
            />
          </label>
          <label>
            Nom (optionnel)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="robia" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" />
          </label>
          <p className="hint">
            {mode === 'local'
              ? 'Le dossier reste où il est : Sangha travaille dans des worktrees à côté, sans toucher ta copie.'
              : 'Le repo est cloné dans workspaces/.'}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" disabled={busy || !source.trim()}>
              {busy ? '…' : mode === 'local' ? 'Ajouter' : 'Cloner'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

/** Confirm dismissing a priest (after his incense was snuffed out, or from his view). */
function Dismiss({ id, working, onClose }: { id: string; working?: boolean; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [dirty, setDirty] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const external = session?.external

  // First without forcing: the server refuses if uncommitted work would be lost, then we ask again.
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.archive(id, dirty !== null)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDirty((err.body as { state: { dirty: number } }).state.dirty)
      else setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={external ? 'Renvoyer cette session de la cour ?' : 'Envoyer ce prêtre au nirvana ?'} onClose={onClose}>
      <div className="form">
        <p>
          {session && <PriestName note={session.note} title={session.title} />}
          <br />
          {external ? (
            <>Elle disparaît de la cour mais son terminal continue ; elle reviendra si elle se remet à travailler.</>
          ) : (
            <>
              Sa session est fermée et son worktree supprimé.
              {session?.branch && (
                <>
                  {' '}
                  Sa branche <code>{session.branch}</code> est conservée si elle contient des commits.
                </>
              )}
            </>
          )}
        </p>
        {working && !external && (
          <p className="form-error" role="alert">
            Il est en train de travailler : son travail en cours sera interrompu.
          </p>
        )}
        {dirty !== null && (
          <p className="form-error" role="alert">
            {dirty} fichier(s) modifié(s) non commité(s) seraient perdus.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Le garder
          </button>
          <button className={`btn ${dirty !== null || (working && !external) ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => void run()}>
            {dirty !== null ? 'Envoyer au nirvana quand même' : external ? 'Renvoyer' : 'Envoyer au nirvana'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** His incense: keep him quiet (or wake him again), or let him go. */
function IncenseChoice({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const set = useApp((s) => s.set)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null
  const silent = session.silenced

  const toggle = async () => {
    try {
      await api.silence(id, !silent)
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <Modal title={silent ? 'Son encens est éteint' : 'Son encens brûle'} onClose={onClose}>
      <div className="form">
        <p>
          <PriestName note={session.note} title={session.title} />
        </p>
        <div className="choice-grid">
          <button className="choice" onClick={() => void toggle()} autoFocus>
            <span className="choice-icon" aria-hidden>
              {silent ? '🔥' : '🤫'}
            </span>
            <b>{silent ? 'Rallumer l’encens' : 'Faire silence'}</b>
            <span className="muted small">
              {silent
                ? 'Il t’appellera de nouveau quand il attendra ta réponse.'
                : 'Il continue son travail, mais ne brille plus et ne t’appelle plus, même s’il attend ta réponse.'}
            </span>
          </button>
          <button className="choice" onClick={() => set({ dialog: { kind: 'dismiss', id } })}>
            <span className="choice-icon" aria-hidden>
              🚪
            </span>
            <b>{session.external ? 'Le renvoyer de la cour' : "L'envoyer au nirvana"}</b>
            <span className="muted small">
              {session.external ? 'Il disparaît de la cour ; son terminal continue.' : 'Sa session est fermée et son espace de travail supprimé.'}
            </span>
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Your own note about a priest, shown under him in the courtyard. */
/**
 * His note. `lotus`: opened on his way to the lotus pond without one — there, hovering him is all
 * you'll see of him, so a word now says where he stands; he goes in once it's saved (or without one).
 */
function NoteEditor({ id, lotus, onClose }: { id: string; lotus?: boolean; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [note, setNote] = useState(session?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const save = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      if (value !== (session.note ?? null)) await api.note(id, value)
    } catch (err) {
      setError(message(err))
      setBusy(false)
      return
    }
    if (lotus) {
      try {
        await api.lotus(id, true)
      } catch (err) {
        setError(lotusFailure(err))
        setBusy(false)
        return
      }
    }
    onClose()
  }

  return (
    <Modal title={lotus ? 'Un mot avant le lotus ?' : 'Petit mot'} onClose={onClose}>
      <div className="form">
        <p>
          <b>{session.title}</b>
        </p>
        {lotus && <p className="muted">Au bassin aux lotus, sa note est ce que tu verras de lui en le survolant : un mot pour te rappeler où il en est.</p>}
        <label>
          Note
          <textarea
            autoFocus
            value={note}
            maxLength={500}
            rows={4}
            placeholder="Un rappel pour toi, affiché sous lui dans la cour…"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void save(note.trim() || null)
              }
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          {lotus ? (
            <button type="button" className="btn btn-ghost" onClick={() => void save(null)} disabled={busy}>
              Sans note
            </button>
          ) : (
            session.note != null && (
              <button type="button" className="btn btn-danger" onClick={() => void save(null)} disabled={busy}>
                Effacer
              </button>
            )
          )}
          <button type="button" className="btn btn-primary" onClick={() => void save(note.trim() || null)} disabled={busy}>
            {lotus ? 'Mettre au lotus' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Confirm taking a project out of the monastery (after its big burner was snuffed out). */
function RemoveProject({ name, onClose }: { name: string; onClose: () => void }) {
  const project = useApp((s) => s.projects.find((p) => p.name === name))
  const priests = useApp((s) => Object.values(s.sessions).filter((x) => x.project === name && !x.external))
  const [dirty, setDirty] = useState<{ title: string; files: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (force: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await api.removeProject(name, force)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDirty((err.body as { dirty: { title: string; files: number }[] }).dirty)
      else setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Retirer ${name} du monastère ?`} onClose={onClose}>
      <div className="form">
        <p>
          {priests.length > 0 && (
            <>
              Ses {priests.length} prêtre(s) seront envoyés au nirvana et leurs worktrees supprimés (les branches avec des commits restent) :
              <ul className="dialog-priest-list">
                {priests.map((p) => (
                  <li key={p.id}>
                    <PriestName note={p.note} title={p.title} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {project?.local ? (
            <>
              Le dossier <code>{project.path}</code> reste intact : il est seulement retiré de Sangha.
            </>
          ) : (
            <>
              Le clone <code>{project?.path}</code> sera <b>supprimé</b>.
            </>
          )}
        </p>
        {dirty && (
          <div className="form-error" role="alert">
            Du travail non commité serait perdu :
            <ul>
              {dirty.map((d) => (
                <li key={d.title}>
                  {d.title} : {d.files} fichier(s)
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Le garder
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void run(!!dirty)}>
            {dirty ? 'Retirer quand même' : 'Retirer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * For case/accent-insensitive matching: one normalized character per original character, so a match's
 * position in the normalized string always lines up with the same position in the original text (so
 * highlighting can slice the original, diacritics and casing intact).
 */
function normChar(ch: string): string {
  const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return (stripped || ch).toLowerCase()
}
const normAligned = (s: string): string => Array.from(s).map(normChar).join('')

/** `text` with every stretch matching one of `words` (already normalized) wrapped in a `<mark>`. */
function highlightWords(text: string, words: string[]): ReactNode {
  if (!text || words.length === 0) return text
  const norm = normAligned(text)
  const ranges: [number, number][] = []
  for (const w of words) {
    if (!w) continue
    for (let from = 0; ; ) {
      const idx = norm.indexOf(w, from)
      if (idx < 0) break
      ranges.push([idx, idx + w.length])
      from = idx + 1
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = [ranges[0]!]
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1]!
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push(r)
  }
  const parts: ReactNode[] = []
  let cursor = 0
  merged.forEach(([s, e], i) => {
    if (s > cursor) parts.push(text.slice(cursor, s))
    parts.push(<mark key={i}>{text.slice(s, e)}</mark>)
    cursor = e
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

/**
 * The moon's history: every priest sent to nirvana, searchable by words (instant, in your own text) or
 * by a question put to a model, and a way to bring one back.
 */
function Nirvana({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const nirvanaTick = useApp((s) => s.nirvanaTick)
  const [entries, setEntries] = useState<NirvanaEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Texte (instant, word-by-word) or IA (a question, sent on demand). An empty field always means both
  // modes show the full list.
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'text' | 'ai'>('text')
  const [aiResults, setAiResults] = useState<NirvanaSearchResult['results'] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const load = () => api.nirvana().then(setEntries, (err) => setError(message(err)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])
  // The moon's history changed (arrival, summary written, another reincarnation): reload it live.
  useEffect(() => {
    if (entries !== null) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nirvanaTick])
  useEffect(() => {
    if (!query.trim()) {
      setMode('text')
      setAiResults(null)
      setAiError(null)
    }
  }, [query])

  const haystack = (e: NirvanaEntry) => normAligned([e.title, e.project, agentTitle(e, projects), e.branch ?? '', e.summary ?? '', e.note ?? ''].join(' \u0000 '))
  const words = useMemo(() => normAligned(query).trim().split(/\s+/).filter(Boolean), [query])
  const filtered = useMemo(() => {
    if (!entries) return []
    if (words.length === 0) return entries
    return entries.filter((e) => words.every((w) => haystack(e).includes(w)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, words, projects])
  const aiList = useMemo(() => {
    if (!entries || !aiResults) return []
    return aiResults
      .map((r) => ({ r, e: entries.find((x) => x.id === r.id) }))
      .filter((x): x is { r: NirvanaSearchResult['results'][number]; e: NirvanaEntry } => !!x.e)
  }, [entries, aiResults])

  const runAiSearch = async () => {
    const q = query.trim()
    if (!q) return
    setMode('ai')
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await api.nirvanaSearch(q)
      setAiResults(res.results)
    } catch (err) {
      setAiError(message(err))
      setAiResults(null)
    } finally {
      setAiBusy(false)
    }
  }

  const reincarnate = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await api.reincarnate(id)
      // He reappears in the courtyard through the stream; here, he just leaves the list.
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusyId(null)
    }
  }

  const renderEntry = (e: NirvanaEntry, opts?: { words?: string[]; reason?: string }) => {
    const hl = (s: string) => (opts?.words?.length ? highlightWords(s, opts.words) : s)
    return (
      <li key={e.id} className="nirvana-entry">
        {/* His own note, more prominent than his title: how you tell this one apart at a glance. */}
        {e.note && <p className="nirvana-note">{hl(e.note)}</p>}
        <div className="nirvana-entry-head">
          <span className="robe-dot small-dot" style={{ background: robeOfAgent(e.agent) }} aria-hidden />
          <b>{hl(e.title)}</b>
          <span className="project-tag" style={{ borderColor: robeOf(e.project, projects) }}>
            {hl(e.project)}
          </span>
        </div>
        <p className="muted small nirvana-meta">
          {hl(agentTitle(e, projects))}
          {e.branch && (
            <>
              {' · '}
              <code>⎇ {hl(e.branch)}</code>
            </>
          )}
          {' · '}
          {formatTime(e.archivedAt)}
          {e.cost != null && e.cost >= 0.01 && <> · {formatCost(e.cost)}</>}
        </p>
        <p className="nirvana-summary">{e.summary ? hl(e.summary) : <span className="muted small">résumé en cours…</span>}</p>
        {opts?.reason && <p className="nirvana-reason muted small">{opts.reason}</p>}
        <div className="nirvana-entry-actions">
          {e.renewed && e.continuedIn ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                onClose()
                openSession(e.continuedIn!)
              }}
              title="Son travail continue dans une session neuve : l'ouvrir"
            >
              Continué dans une session neuve →
            </button>
          ) : e.renewed ? (
            <span className="badge">continué dans une session neuve, partie au nirvana elle aussi</span>
          ) : null}
          {/* Even renewed, his own conversation can come back (to read it, or to pick up from there). */}
          <button
            className="btn btn-ghost"
            disabled={busyId === e.id}
            onClick={() => void reincarnate(e.id)}
            title={e.renewed ? 'Le faire revenir avec son ancienne conversation, à côté de la session neuve (même dossier : ne les fais pas travailler en même temps)' : undefined}
          >
            {busyId === e.id ? 'Réincarnation…' : 'Réincarner'}
          </button>
        </div>
      </li>
    )
  }

  return (
    <Modal title="Nirvana" onClose={onClose}>
      <div className="form">
        {entries === null && !error && <p className="hint">Ouverture des archives…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {entries?.length === 0 && <p className="hint">Personne n’a encore rejoint le nirvana. Ceux que tu y enverras attendront ici, en paix.</p>}
        {entries && entries.length > 0 && (
          <>
            <label className="nirvana-search">
              Chercher
              <div className="nirvana-search-field">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (mode === 'ai') void runAiSearch()
                    } else if (e.key === 'Escape' && query) {
                      // Vide le champ d'abord ; un deuxième Échap (champ déjà vide) ferme le nirvana.
                      e.preventDefault()
                      setQuery('')
                    }
                  }}
                  placeholder="Titre, projet, branche, note…"
                />
                <button
                  type="button"
                  className={`btn btn-ghost${mode === 'ai' ? ' active' : ''}`}
                  disabled={aiBusy || !query.trim()}
                  onClick={() => void runAiSearch()}
                  aria-pressed={mode === 'ai'}
                  title="Chercher avec l’IA : pose ta question en une phrase"
                >
                  {aiBusy ? '✦ Il cherche…' : '✦'}
                </button>
              </div>
            </label>
            {mode === 'text' && query.trim() && (
              <p className="nirvana-search-count muted small">
                {filtered.length} sur {entries.length}
              </p>
            )}
            {mode === 'ai' && aiError && (
              <p className="form-error" role="alert">
                {aiError}
              </p>
            )}
            {mode === 'ai' ? (
              !aiBusy &&
              !aiError &&
              aiResults !== null &&
              (aiList.length === 0 ? (
                <p className="hint">Rien ne correspond à cette question.</p>
              ) : (
                <ul className="nirvana-list">{aiList.map(({ e, r }) => renderEntry(e, { reason: r.reason }))}</ul>
              ))
            ) : filtered.length === 0 ? (
              <p className="hint">Rien ne correspond à ces mots.</p>
            ) : (
              <ul className="nirvana-list">{filtered.map((e) => renderEntry(e, { words }))}</ul>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** What every session would have cost at API prices, since monitoring began, one block per month. */
function Costs({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const sessions = useApp((s) => s.sessions)
  const [report, setReport] = useState<CostReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void api.costs().then(setReport, (err) => setError(message(err))), [])

  const since = report?.since ? new Date(report.since).toLocaleDateString('fr', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const monthLabel = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('fr', { month: 'long', year: 'numeric' })

  return (
    <Modal title="Dépenses" onClose={onClose}>
      <div className="form">
        {!report && !error && <p className="hint">Ouverture du bilan…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {report && report.months.length === 0 && <p className="hint">Aucune session pour l’instant.</p>}
        {report && report.months.length > 0 && (
          <>
            <p className="costs-total">
              <b>{formatCost(report.total)}</b> au total, sur {report.sessions} session{report.sessions > 1 ? 's' : ''}
              {since && <> depuis le {since}</>}.
            </p>
            <ul className="costs-months">
              {report.months.map((m) => {
                const maxProject = Math.max(0.01, ...m.projects.map((p) => p.cost))
                return (
                  <li key={m.month} className="costs-month">
                    <div className="costs-month-head">
                      <b>{monthLabel(m.month)}</b>
                      <span className="muted small">
                        {m.sessions} session{m.sessions > 1 ? 's' : ''} · {formatCost(m.cost)}
                      </span>
                    </div>
                    <ul className="costs-bars">
                      {m.projects.map((p) => (
                        <li key={p.project} className="costs-bar-row">
                          <span className="project-tag" style={{ borderColor: robeOf(p.project, projects) }}>
                            {p.project}
                          </span>
                          <span className="costs-bar-track">
                            <span className="costs-bar-fill" style={{ width: `${(p.cost / maxProject) * 100}%`, background: robeOf(p.project, projects) }} />
                          </span>
                          <span className="costs-bar-value muted small">
                            {p.sessions} · {formatCost(p.cost)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {m.record && (
                      <p className="costs-record muted small">
                        {/* He may have left since (his cost record outlives the session): his note only
                            shows if he's still in the courtyard to carry it. */}
                        <PriestName note={sessions[m.record.id]?.note} title={m.record.title} /> ({m.record.project}) · {formatCost(m.record.cost)} · record du mois
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}

const LIBRARY_STATUS = (m: LibraryMcp): { label: string; tone: 'on' | 'off' | 'missing' } =>
  m.active ? { label: 'activé', tone: 'on' } : m.missing ? { label: 'identifiants manquants', tone: 'missing' } : { label: 'désactivé', tone: 'off' }

/**
 * A server's credentials, pre-filled from what is already saved (secret fields stay empty, with a
 * placeholder saying so). `activateOnSave`: this form was opened to activate him, so saving also turns
 * him on (the server refuses if a required field is still missing).
 */
function LibraryCredentialsForm({
  mcp,
  activateOnSave,
  onCancel,
  onSaved,
}: {
  mcp: LibraryMcp
  activateOnSave: boolean
  onCancel: () => void
  onSaved: (list: LibraryMcp[]) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(mcp.fields.map((f) => [f.key, f.secret ? '' : (f.value ?? '')])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.setLibraryMcp(mcp.name, { values, ...(activateOnSave ? { active: true } : {}) }))
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">
        Identifiants de <b>{mcp.name}</b>
        {activateOnSave && ', pour l’activer'}.
      </p>
      {mcp.fields.map((f) => (
        <label key={f.key}>
          {f.label} {f.optional && <span className="muted small">(facultatif)</span>}
          <input
            type={f.secret ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={f.secret ? (f.set ? 'enregistré — laisser vide pour garder' : f.placeholder) : f.placeholder}
            autoComplete="off"
          />
        </label>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '…' : activateOnSave ? 'Enregistrer et activer' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

/**
 * Sangha's own MCP servers, known but switched off until you activate one (in memory only: a restart of
 * the server turns them all off again). Once active, a server joins every priest's 🔌 catalog.
 */
/** MCP servers switched for all of Sangha: every priest follows, unless he has his own switch (his MCP menu). */
function McpDialog({ onClose, onLibrary }: { onClose: () => void; onLibrary: () => void }) {
  const [list, setList] = useState<GlobalMcp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => void api.globalMcp().then(setList, (e) => setError(message(e))), [])

  const toggle = (m: GlobalMcp) => {
    setBusy(m.name)
    setError(null)
    api
      .setGlobalMcp(m.name, !m.enabled)
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Modal title="Serveurs MCP" onClose={onClose}>
      <div className="form">
        <p className="hint">Pour tous les prêtres, sauf ceux qui ont leur propre réglage (menu MCP d’un prêtre).</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {list === null && !error && <p className="muted small">Chargement…</p>}
        {list && (
          <ul className="mcp-list">
            {[...list]
              .sort((a, b) => Number(b.enabled) - Number(a.enabled))
              .map((m) => {
                const claudeAi = m.name.startsWith('claude.ai ')
                const plugin = /^plugin:[^:]+:(.+)$/.exec(m.name)?.[1]
                return (
                  <li key={m.name} className="mcp-row">
                    <span className="mcp-name" title={`Portée : ${m.scope}`}>
                      {claudeAi ? m.name.slice('claude.ai '.length) : (plugin ?? m.name)}
                      {claudeAi && <span className="mcp-tag">claude.ai</span>}
                      {plugin && <span className="mcp-tag">plugin</span>}
                      {m.scope === 'library' && <span className="mcp-tag">Sangha</span>}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={m.enabled}
                      aria-label={`${m.enabled ? 'Désactiver' : 'Activer'} ${m.name}`}
                      className={`mcp-switch ${m.enabled ? 'on' : ''}`}
                      disabled={busy === m.name}
                      onClick={() => toggle(m)}
                    >
                      <span className="mcp-switch-knob" aria-hidden />
                    </button>
                  </li>
                )
              })}
          </ul>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onLibrary}>
            📚 Bibliothèque de Sangha
          </button>
        </div>
      </div>
    </Modal>
  )
}

function McpLibraryDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<LibraryMcp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // name mid-request, list view only
  const [editing, setEditing] = useState<{ mcp: LibraryMcp; activateOnSave: boolean } | null>(null)

  const reload = () => api.mcpLibrary().then(setList, (e) => setError(message(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), [])

  const activate = (m: LibraryMcp) => {
    if (m.missing) return setEditing({ mcp: m, activateOnSave: true })
    setBusy(m.name)
    setError(null)
    api
      .setLibraryMcp(m.name, { active: true })
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  const deactivate = (m: LibraryMcp) => {
    setBusy(m.name)
    setError(null)
    api
      .setLibraryMcp(m.name, { active: false })
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Modal title="Bibliothèque de MCP" onClose={onClose}>
      {!editing ? (
        <div className="form">
          <p className="hint">Des serveurs MCP connus de Sangha, activés, ils sont allumés chez tous les prêtres (chacun peut l’éteindre pour lui).</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {list === null && !error && <p className="muted small">Chargement…</p>}
          {list?.length === 0 && <p className="muted small">La bibliothèque est vide pour l’instant.</p>}
          {list && list.length > 0 && (
            <ul className="library-list">
              {list.map((m) => {
                const status = LIBRARY_STATUS(m)
                return (
                  <li key={m.name} className="library-row">
                    <div className="library-row-head">
                      <b>{m.name}</b>
                      <span className={`library-status library-status-${status.tone}`}>{status.label}</span>
                    </div>
                    <p className="muted small library-desc">{m.description}</p>
                    <div className="library-row-actions">
                      <button type="button" className="text-link" disabled={busy === m.name} onClick={() => setEditing({ mcp: m, activateOnSave: false })}>
                        Identifiants
                      </button>
                      {m.active ? (
                        <button type="button" className="btn btn-ghost" disabled={busy === m.name} onClick={() => deactivate(m)}>
                          {busy === m.name ? '…' : 'Désactiver'}
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary" disabled={busy === m.name} onClick={() => activate(m)}>
                          {busy === m.name ? '…' : 'Activer'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="hint">Activation gardée jusqu’au redémarrage de Sangha ; identifiants enregistrés dans ~/.config/sangha/.env.</p>
        </div>
      ) : (
        <LibraryCredentialsForm
          mcp={editing.mcp}
          activateOnSave={editing.activateOnSave}
          onCancel={() => setEditing(null)}
          onSaved={(l) => {
            setList(l)
            setEditing(null)
          }}
        />
      )}
    </Modal>
  )
}

const ELDER_STATUS_LABEL: Record<ElderTopicStatus | 'all', string> = { all: 'Tous', proposed: 'Proposés', accepted: 'Acceptés', rejected: 'Rejetés', done: 'Faits' }
const ELDER_WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const ELDER_LEVEL_LABEL: Record<'manual' | 'sangha' | 'project', string> = { manual: 'Retours manuels', sangha: 'Sangha', project: 'Projets' }

/** 'manual' → Retours manuels, 'sangha' → Sangha, 'project:<nom>' → Projet <nom>. */
function elderScopeLabel(scope: string): string {
  if (scope === 'manual') return 'Retours manuels'
  if (scope === 'sangha') return 'Sangha'
  return /^project:(.+)$/.exec(scope)?.[1] ? `Projet ${/^project:(.+)$/.exec(scope)![1]}` : scope
}

/** A topic's evidence: a link to the conversation when it's a session still known here, a quiet word otherwise. */
function ElderEvidence({ evidence }: { evidence: string[] }) {
  const sessions = useApp((s) => s.sessions)
  if (!evidence.length) return null
  return (
    <p className="muted small">
      Preuves :{' '}
      {evidence.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          {sessions[id] ? (
            <button type="button" className="text-link" onClick={() => openSession(id)}>
              {priestLabel(sessions[id]!)}
            </button>
          ) : (
            'un retour'
          )}
        </span>
      ))}
    </p>
  )
}

/**
 * Ananda's panel: his suggestions grouped by where they come from, his latest reports, a plain
 * discussion with him, and his own réglages — every one a real control (a model picker shared with a
 * priest's own, the projects you actually follow as checkboxes, a day and an hour for the weekly
 * pass), never a raw string to type by hand.
 */
function ElderDialog({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const models = useApp((s) => s.models)
  const elderBadge = useApp((s) => s.elderBadge)
  const [state, setState] = useState<ElderState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'topics' | 'reports' | 'chat' | 'settings'>('topics')
  const [statusFilter, setStatusFilter] = useState<ElderTopicStatus | 'all'>('all')
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [meditating, setMeditating] = useState(false)

  const load = () => api.elder().then(setState, (e: unknown) => setError(message(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])
  // His badge changed (a pass started, ended, or a sujet count moved): the open panel follows along.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void (state && load()), [elderBadge?.proposed, elderBadge?.running])

  const vote = (id: string, v: 'up' | 'down') => api.voteElderTopic(id, v).then(load, (e: unknown) => setError(message(e)))
  const markDone = (id: string) => api.doneElderTopic(id).then(load, (e: unknown) => setError(message(e)))
  const meditateNow = async () => {
    setMeditating(true)
    setError(null)
    try {
      await api.runElderNow()
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setMeditating(false)
    }
  }
  const sendChat = async () => {
    const text = chatText.trim()
    if (!text) return
    setChatBusy(true)
    setError(null)
    try {
      await api.askElder(text)
      setChatText('')
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setChatBusy(false)
    }
  }
  const saveSettings = (patch: ElderSettingsPatch) => api.saveElderSettings(patch).then(load, (e: unknown) => setError(message(e)))
  const toggleProject = (name: string) => {
    if (!state) return
    const next = state.settings.projects.includes(name) ? state.settings.projects.filter((p) => p !== name) : [...state.settings.projects, name]
    saveSettings({ projects: next })
  }

  if (!state)
    return (
      <Modal onClose={onClose} title="Ananda">
        {error ? <p className="form-error">{error}</p> : <p className="muted">Chargement…</p>}
      </Modal>
    )

  const byScope = (topics: ElderTopic[]) => {
    const groups = new Map<string, ElderTopic[]>()
    for (const t of topics) groups.set(t.scope, [...(groups.get(t.scope) ?? []), t])
    return [...groups.entries()]
  }
  const topics = state.topics.filter((t) => statusFilter === 'all' || t.status === statusFilter)
  const engine = state.settings.model.includes('::') ? 'provider' : 'claude'

  return (
    <Modal onClose={onClose} title="Ananda, le vieux sage">
      <div className="elder-dialog">
        <div className="elder-status">
          <p>
            {state.running
              ? 'Il médite en ce moment…'
              : state.settings.enabled
                ? `Prochain passage : ${state.nextRunAt ? formatTime(state.nextRunAt) : 'à déterminer'}`
                : 'Désactivé pour l’instant.'}
          </p>
          <button type="button" className="btn btn-ghost" disabled={state.running || meditating} onClick={() => void meditateNow()}>
            {meditating || state.running ? 'Médite…' : 'Médite maintenant'}
          </button>
        </div>
        {state.lastError && <p className="form-error">Dernière erreur d’Ananda : {state.lastError}</p>}
        {error && <p className="form-error">{error}</p>}

        <nav className="segmented elder-tabs" role="tablist" aria-label="Section du panneau d’Ananda">
          {(['topics', 'reports', 'chat', 'settings'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {{ topics: 'Sujets', reports: 'Rapports', chat: 'Discussion', settings: 'Réglages' }[k]}
            </button>
          ))}
        </nav>

        {tab === 'topics' &&
          (topics.length === 0 ? (
            <p className="muted">Aucun sujet {statusFilter === 'all' ? '' : ELDER_STATUS_LABEL[statusFilter].toLowerCase()} pour l’instant.</p>
          ) : null)}
        {tab === 'topics' && (
          <div className="elder-topics">
            <div className="segmented elder-filters" role="tablist" aria-label="Filtrer les sujets par statut">
              {(['all', 'proposed', 'accepted', 'rejected', 'done'] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={statusFilter === f} className={statusFilter === f ? 'active' : ''} onClick={() => setStatusFilter(f)}>
                  {ELDER_STATUS_LABEL[f]}
                </button>
              ))}
            </div>
            {byScope(topics).map(([scope, list]) => (
              <section key={scope} className="elder-scope">
                <h4>{elderScopeLabel(scope)}</h4>
                <ul>
                  {list.map((t) => (
                    <li key={t.id} className="elder-topic">
                      <div className="elder-topic-head">
                        <b>{t.title}</b>
                        <span className="muted small">({ELDER_STATUS_LABEL[t.status].toLowerCase()})</span>
                      </div>
                      <p>{t.detail}</p>
                      <ElderEvidence evidence={t.evidence} />
                      <div className="elder-topic-actions">
                        <button type="button" className={`icon-btn${t.status === 'accepted' ? ' active-up' : ''}`} onClick={() => vote(t.id, 'up')} aria-pressed={t.status === 'accepted'} aria-label="Approuver ce sujet">
                          👍
                        </button>
                        <button type="button" className={`icon-btn${t.status === 'rejected' ? ' active-down' : ''}`} onClick={() => vote(t.id, 'down')} aria-pressed={t.status === 'rejected'} aria-label="Rejeter ce sujet">
                          👎
                        </button>
                        {t.status === 'accepted' && (
                          <button type="button" className="text-link" onClick={() => markDone(t.id)}>
                            Marquer fait
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === 'reports' &&
          (state.reports.length === 0 ? (
            <p className="muted">Pas encore de rapport.</p>
          ) : (
            <ul className="elder-reports">
              {state.reports.map((r) => (
                <li key={r.id}>
                  <div className="elder-report-head">
                    <time>{formatTime(r.createdAt)}</time>
                    <span className="muted small">
                      {{ daily: 'quotidien', weekly: 'hebdomadaire', conversation: 'fin de conversation', manual: 'médite maintenant', skipped: 'semaine sautée' }[r.kind]}
                    </span>
                  </div>
                  <p>{r.text}</p>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'chat' && (
          <div className="elder-chat">
            <ul>
              {state.chat.length === 0 && <li className="muted small">Rien dit pour l’instant : pose-lui une question.</li>}
              {state.chat.map((h) => (
                <li key={h.id} className={h.role === 'user' ? 'msg msg-user' : 'msg msg-buddha'}>
                  {h.text}
                </li>
              ))}
            </ul>
            <form
              className="elder-chat-form"
              onSubmit={(e) => {
                e.preventDefault()
                void sendChat()
              }}
            >
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Une question pour Ananda…" disabled={chatBusy} />
              <button type="submit" className="btn btn-primary" disabled={chatBusy || !chatText.trim()}>
                Envoyer
              </button>
            </form>
          </div>
        )}

        {tab === 'settings' && (
          <div className="elder-settings form">
            <label className="inline-radio">
              <input type="checkbox" checked={state.settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} /> Activé
            </label>
            <label>
              Moteur
              <select value={state.settings.model} onChange={(e) => saveSettings({ model: e.target.value })}>
                {!models.some((m) => m.id === state.settings.model) && <option value={state.settings.model}>{state.settings.model}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              {engine === 'claude'
                ? 'Sur l’abonnement : passage hebdomadaire, sous garde de quota.'
                : 'Sur un fournisseur : passage quotidien, et à la fin d’une conversation qui a un retour non traité.'}
            </p>
            <fieldset>
              <legend>Ce qu’il relit</legend>
              {(['manual', 'sangha', 'project'] as const).map((lvl) => (
                <label key={lvl} className="inline-radio">
                  <input type="checkbox" checked={state.settings.levels[lvl]} onChange={(e) => saveSettings({ levels: { [lvl]: e.target.checked } })} /> {ELDER_LEVEL_LABEL[lvl]}
                </label>
              ))}
            </fieldset>
            {state.settings.levels.project && (
              <fieldset>
                <legend>Projets suivis</legend>
                {projects.length === 0 ? (
                  <p className="hint">Aucun projet pour l’instant.</p>
                ) : (
                  projects.map((p) => (
                    <label key={p.name} className="inline-radio">
                      <input type="checkbox" checked={state.settings.projects.includes(p.name)} onChange={() => toggleProject(p.name)} /> {p.name}
                    </label>
                  ))
                )}
              </fieldset>
            )}
            <label>
              Heure quotidienne <span className="muted small">(moteur fournisseur)</span>
              <input type="time" value={state.settings.dailyAt} onChange={(e) => saveSettings({ dailyAt: e.target.value })} />
            </label>
            <fieldset>
              <legend>
                Passage hebdomadaire <span className="muted small">(moteur Claude)</span>
              </legend>
              <div className="elder-weekly-row">
                <label>
                  Jour
                  <select value={state.settings.weekly.day} onChange={(e) => saveSettings({ weekly: { day: Number(e.target.value) } })}>
                    {ELDER_WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Heure
                  <input type="time" value={state.settings.weekly.at} onChange={(e) => saveSettings({ weekly: { at: e.target.value } })} />
                </label>
                <label>
                  Seuil de quota (% max utilisé)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={state.settings.weekly.maxWeekUsedPct}
                    onChange={(e) => saveSettings({ weekly: { maxWeekUsedPct: Number(e.target.value) } })}
                  />
                </label>
              </div>
            </fieldset>
            <label>
              Plafond du contexte envoyé <span className="muted small">(caractères)</span>
              <input type="number" min={1000} step={1000} value={state.settings.maxInputChars} onChange={(e) => saveSettings({ maxInputChars: Number(e.target.value) })} />
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function Dialogs() {
  const { dialog, set } = useApp()
  const close = () => set({ dialog: null })
  if (!dialog) return null
  if (dialog.kind === 'new-session') return <NewSession project={dialog.project} onClose={close} />
  if (dialog.kind === 'add-project') return <AddProject onClose={close} />
  if (dialog.kind === 'remove-project') return <RemoveProject name={dialog.name} onClose={close} />
  if (dialog.kind === 'incense') return <IncenseChoice id={dialog.id} onClose={close} />
  if (dialog.kind === 'note') return <NoteEditor id={dialog.id} lotus={dialog.lotus} onClose={close} />
  if (dialog.kind === 'nirvana') return <Nirvana onClose={close} />
  if (dialog.kind === 'costs') return <Costs onClose={close} />
  if (dialog.kind === 'providers') return <Providers onClose={close} />
  if (dialog.kind === 'git') return <GitIdentityDialog onClose={close} />
  if (dialog.kind === 'shepherd') return <ShepherdDialog id={dialog.id} onClose={close} />
  if (dialog.kind === 'env') return <EnvDialog id={dialog.id} onClose={close} />
  if (dialog.kind === 'autonomy') return <AutonomyDialog id={dialog.id} onClose={close} />
  if (dialog.kind === 'host') return <HostDialog onClose={close} />
  if (dialog.kind === 'mcp') return <McpDialog onClose={close} onLibrary={() => set({ dialog: { kind: 'mcp-library' } })} />
  // Reached from the MCP dialog: closing it goes back there.
  if (dialog.kind === 'mcp-library') return <McpLibraryDialog onClose={() => set({ dialog: { kind: 'mcp' } })} />
  if (dialog.kind === 'dismiss') return <Dismiss id={dialog.id} working={dialog.working} onClose={close} />
  return <ElderDialog onClose={close} />
}

/**
 * A session's own environment variables, written like a .env (paste one as is). His process starts with
 * them: saved alone, they apply at his next start; "and relaunch" applies them now.
 */
function EnvDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [text, setText] = useState(() => envText(session?.env ?? {}))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null
  const { env, errors } = parseEnvText(text)
  const count = Object.keys(env).length

  const save = async (restart: boolean) => {
    if (restart && session.status === 'working' && !confirm(`${priestLabel(session)} travaille : relancer interrompt son tour en cours. Relancer quand même ?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.setEnv(id, env, restart)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Variables d'environnement" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(false)
        }}
      >
        <p className="muted">
          Propres à <PriestName note={session.note} title={session.title} /> : son process démarre avec, ses commandes et ses novices en héritent. Une par ligne, comme un fichier <code>.env</code>.
        </p>
        <textarea
          autoFocus
          className="handoff-context env-text"
          value={text}
          rows={10}
          spellCheck={false}
          placeholder={'OS_CLOUD=poc-axel\nKUBECONFIG=/Users/moi/.kube/poc\n# un commentaire'}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="muted small">
          {count} variable{count > 1 ? 's' : ''} · gardées dans la base locale de Sangha, et reprises par sa session neuve s'il en change.
        </p>
        {errors.map((e) => (
          <p key={e} className="form-error">
            {e}
          </p>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn btn-ghost" disabled={busy || errors.length > 0} title="Elles s'appliqueront à son prochain démarrage">
            Enregistrer
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || errors.length > 0} onClick={() => void save(true)} title="Le relance sur la même conversation pour qu'elles s'appliquent tout de suite">
            Enregistrer et relancer
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Confiding a priest to Buddha, who will have him move to a fresh session at the right moment. What you
 * write here (as long as needed) goes to a file under /tmp the fresh session reads first, like a skill.
 */
function ShepherdDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const confide = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.shepherd(id, true, context.trim() || undefined)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Confier à Bouddha" onClose={onClose}>
      <form className="form" onSubmit={confide}>
        <p className="muted">
          Bouddha fera passer <PriestName note={session.note} title={session.title} /> dans une session neuve au moment qui lui convient, avec la passation qu'il écrira. Ajoute ici tout le contexte
          que la nouvelle session doit avoir, même très long : il sera mis dans un fichier temporaire (sous <code>/tmp</code>) qu'elle lira en premier, comme un skill.
        </p>
        <label>
          Contexte pour la session neuve <span className="muted small">(facultatif)</span>
          <textarea
            autoFocus
            className="handoff-context"
            value={context}
            rows={14}
            placeholder={'Objectif, décisions, contraintes, liens, extraits de logs…'}
            onChange={(e) => setContext(e.target.value)}
          />
        </label>
        {context.length > 0 && <p className="muted small">{context.length.toLocaleString('fr-FR')} caractères</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Confier
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** A loop's rhythm, as a fixed choice; "libre" is typed free-form, validated by `CUSTOM_INTERVAL_RE`. */
const AUTONOMY_INTERVALS: Record<string, string> = { '5m': '5 min', '15m': '15 min', '1h': '1 h' }
const CUSTOM_INTERVAL_RE = /^\d+[smhd]$/

/**
 * His autonomy: the one engine that keeps him going on his own, never both at once — a `/goal` (turn
 * after turn, until it is met) or a `/loop` (he wakes himself up, again and again, on the same
 * instruction). Opens on whichever he currently runs; both tabs are prefilled with what he last had,
 * even stopped, so relaunching or switching between them is a formality. Starting one stops the other.
 */
function AutonomyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const current = session?.autonomy ?? null
  const [tab, setTab] = useState<'goal' | 'loop'>(current?.mode ?? 'goal')
  const [goalText, setGoalText] = useState(current?.mode === 'goal' ? current.text : '')
  const [loopText, setLoopText] = useState(current?.mode === 'loop' ? current.text : '')
  const [rhythm, setRhythm] = useState<'auto' | '5m' | '15m' | '1h' | 'custom'>(() => {
    if (current?.mode !== 'loop') return 'auto'
    const iv = current.interval
    if (iv === null) return 'auto'
    return iv === '5m' || iv === '15m' || iv === '1h' ? iv : 'custom'
  })
  const [customInterval, setCustomInterval] = useState(() => {
    if (current?.mode !== 'loop') return ''
    const iv = current.interval
    return iv && iv !== '5m' && iv !== '15m' && iv !== '1h' ? iv : ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const interval = rhythm === 'auto' ? null : rhythm === 'custom' ? customInterval.trim() : rhythm
  const customInvalid = rhythm === 'custom' && !CUSTOM_INTERVAL_RE.test(customInterval.trim())

  const switchTab = (t: 'goal' | 'loop') => {
    setTab(t)
    setError(null)
  }

  const run = async (body: { mode: 'goal' | 'loop'; text: string; interval?: string | null } | null) => {
    setBusy(true)
    setError(null)
    try {
      await api.autonomy(id, body)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  const launchGoal = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!goalText.trim()) return
    void run({ mode: 'goal', text: goalText.trim() })
  }

  const launchLoop = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!loopText.trim() || customInvalid) return
    void run({ mode: 'loop', text: loopText.trim(), interval })
  }

  // Plain Enter submits (as every other dialog's textarea here); Shift+Enter keeps its newline.
  const enterSubmits = (submit: () => void) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <Modal title="Autonomie" onClose={onClose}>
      <div className="form">
        <p className="muted">
          Pour <PriestName note={session.note} title={session.title} />.
        </p>
        {current?.active && (
          <div className="autonomy-current">
            <p className="muted">
              En cours :{' '}
              {current.mode === 'goal' ? (
                <>◎ Objectif — {current.text}</>
              ) : (
                <>
                  ↻ Boucle — {current.text} · {current.interval ? `toutes les ${AUTONOMY_INTERVALS[current.interval] ?? current.interval}` : 'à son rythme'}
                </>
              )}
            </p>
            <button type="button" className="btn btn-ghost btn-quiet" onClick={() => void run(null)} disabled={busy}>
              Arrêter
            </button>
          </div>
        )}

        <div className="segmented" role="tablist" aria-label="Mode d'autonomie">
          <button type="button" role="tab" aria-selected={tab === 'goal'} className={tab === 'goal' ? 'active' : ''} onClick={() => switchTab('goal')}>
            Objectif
          </button>
          <button type="button" role="tab" aria-selected={tab === 'loop'} className={tab === 'loop' ? 'active' : ''} onClick={() => switchTab('loop')}>
            Boucle
          </button>
        </div>

        {tab === 'goal' ? (
          <form className="form" onSubmit={launchGoal}>
            <p className="muted">Il enchaîne les tours tout seul jusqu'à ce que ce soit atteint.</p>
            {current?.active && current.mode === 'loop' && <p className="hint">Lancer un objectif arrête la boucle en cours.</p>}
            <label>
              Ce qu'il doit atteindre
              <textarea
                autoFocus
                className="handoff-context"
                value={goalText}
                rows={6}
                placeholder="Ex. : tous les tests passent et la PR est ouverte"
                onChange={(e) => setGoalText(e.target.value)}
                onKeyDown={enterSubmits(() => launchGoal())}
              />
            </label>
            <p className="muted small">Interrompre l'arrête aussi.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !goalText.trim()}>
                {current?.active && current.mode === 'goal' ? 'Mettre à jour' : 'Lancer'}
              </button>
            </div>
          </form>
        ) : (
          <form className="form" onSubmit={launchLoop}>
            <p className="muted">Il se réveille de lui-même pour recommencer, jusqu'à ce que tu l'arrêtes.</p>
            {current?.active && current.mode === 'goal' && <p className="hint">Lancer une boucle arrête l'objectif en cours.</p>}
            <label>
              La consigne à répéter
              <textarea
                autoFocus
                className="handoff-context"
                value={loopText}
                rows={6}
                placeholder="Ex. : relis les PR ouvertes, relance les démarches bloquées"
                onChange={(e) => setLoopText(e.target.value)}
                onKeyDown={enterSubmits(() => launchLoop())}
              />
            </label>
            <fieldset>
              <legend>Rythme</legend>
              <label className="inline-radio">
                <input type="radio" name="autonomy-rhythm" checked={rhythm === 'auto'} onChange={() => setRhythm('auto')} />
                Il choisit son rythme
              </label>
              <label className="inline-radio">
                <input type="radio" name="autonomy-rhythm" checked={rhythm === '5m'} onChange={() => setRhythm('5m')} />
                5 min
              </label>
              <label className="inline-radio">
                <input type="radio" name="autonomy-rhythm" checked={rhythm === '15m'} onChange={() => setRhythm('15m')} />
                15 min
              </label>
              <label className="inline-radio">
                <input type="radio" name="autonomy-rhythm" checked={rhythm === '1h'} onChange={() => setRhythm('1h')} />1 h
              </label>
              <label className="inline-radio autonomy-rhythm-free">
                <input type="radio" name="autonomy-rhythm" checked={rhythm === 'custom'} onChange={() => setRhythm('custom')} />
                Libre
                {rhythm === 'custom' && (
                  <input
                    className="autonomy-rhythm-input"
                    value={customInterval}
                    onChange={(e) => setCustomInterval(e.target.value)}
                    placeholder="ex. 90m"
                    aria-label="Rythme libre"
                    aria-invalid={customInvalid}
                  />
                )}
              </label>
              {rhythm === 'custom' && customInterval.length > 0 && customInvalid && <p className="form-error">Un nombre suivi de s, m, h ou j (ex. 90m).</p>}
            </fieldset>
            <p className="muted small">Interrompre l'arrête aussi.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !loopText.trim() || customInvalid}>
                {current?.active && current.mode === 'loop' ? 'Mettre à jour' : 'Lancer'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

/** Who every priest commits as. Required: until it is set, Sangha refuses them git. */
function GitIdentityDialog({ onClose }: { onClose: () => void }) {
  const { gitIdentity, set } = useApp()
  const [name, setName] = useState(gitIdentity?.name ?? '')
  const [email, setEmail] = useState(gitIdentity?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      set({ gitIdentity: await api.saveGitIdentity({ name: name.trim(), email: email.trim() }) })
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Identité git des commits" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <p className="muted">
          Tous les prêtres commitent sous ce nom et cet email, quel que soit le projet. Tant qu'ils ne sont pas renseignés, git leur est refusé.
        </p>
        <label>
          Nom
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" autoComplete="name" />
        </label>
        <label>
          Email
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@exemple.com" autoComplete="email" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !email.trim()}>
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
}

const EMPTY_PROVIDER: Partial<Provider> = { name: '', baseUrl: '', apiKey: '', authToken: '', timeoutMs: 3_000_000, models: null }

/**
 * Endpoints Claude Code can run on instead of Claude (e.g. OVH AI endpoints): address and credentials set
 * once; Sangha sets every ANTHROPIC_* model variable to the model each session picks. Models: all those the
 * endpoint lists (kept current), or only the ones you tick.
 */
function Providers({ onClose }: { onClose: () => void }) {
  const set = useApp((s) => s.set)
  const [list, setList] = useState<Provider[] | null>(null)
  const [edit, setEdit] = useState<Partial<Provider> | null>(null)
  const [found, setFound] = useState<string[] | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    api.providers().then(
      (l) => {
        setList(l)
        setError(null)
      },
      (e: unknown) => {
        setList([])
        setError(
          e instanceof ApiError && e.status === 404
            ? 'Le serveur tourne sur une version d’avant les fournisseurs : redémarre-le (make dev).'
            : `Fournisseurs illisibles : ${message(e)}`,
        )
      },
    )
    // The model choices (top left, new session, each session) follow.
    api.models().then((models) => set({ models }), () => undefined)
  }
  useEffect(reload, [])

  const open = (p: Partial<Provider>) => {
    setEdit({ ...p })
    setFound(null)
    setExported(null)
    setError(null)
  }
  const field = (k: keyof Provider) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((p) => ({ ...p, [k]: e.target.value }))

  const probe = async () => {
    if (!edit?.baseUrl) return
    setBusy(true)
    setError(null)
    try {
      setFound(await api.probeModels({ baseUrl: edit.baseUrl, apiKey: edit.apiKey ?? '', authToken: edit.authToken ?? '' }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!edit) return
    setBusy(true)
    setError(null)
    try {
      await api.saveProvider(edit)
      setEdit(null)
      reload()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Provider) => {
    if (!confirm(`Retirer ${p.name} ? Ses sessions repasseront sur Claude.`)) return
    await api.removeProvider(p.id).catch((e: Error) => setError(e.message))
    reload()
  }

  const chosen = edit?.models ?? null
  const toggle = (m: string) =>
    setEdit((p) => {
      const cur = p?.models ?? []
      return { ...p, models: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] }
    })
  // Everything to tick: what the endpoint lists, plus what you kept that it no longer lists.
  const tickable = [...new Set([...(found ?? []), ...(chosen ?? [])])].sort()

  return (
    <Modal title="Fournisseurs de modèles" onClose={onClose}>
      {!edit ? (
        <div className="form">
          <p className="hint">Un endpoint compatible Anthropic (ex. OVH AI Endpoints) à la place de Claude : adresse et identifiants une fois, le modèle au choix pour chaque session.</p>
          {error ? (
            <p className="form-error">{error}</p>
          ) : list === null ? (
            <p className="muted small">Chargement…</p>
          ) : list.length === 0 ? (
            <p className="muted small">Aucun fournisseur pour l’instant : tout tourne sur Claude.</p>
          ) : (
            <ul className="provider-list">
              {list.map((p) => (
                <li key={p.id}>
                  <span>
                    <b>{p.name}</b> <span className="muted small">{p.baseUrl}</span>
                    <br />
                    <span className="muted small">{p.models ? `${p.models.length} modèle(s) choisi(s)` : 'Tous les modèles de l’endpoint'}</span>
                  </span>
                  <span className="provider-actions">
                    <button type="button" className="text-link" onClick={() => open(p)}>
                      Modifier
                    </button>
                    <button type="button" className="text-link" onClick={() => void remove(p)}>
                      Retirer
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => open(EMPTY_PROVIDER)}>
              + Fournisseur
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <label>
            Nom
            <input value={edit.name ?? ''} onChange={field('name')} required placeholder="OVH" />
          </label>
          <label>
            URL de base (ANTHROPIC_BASE_URL)
            <input value={edit.baseUrl ?? ''} onChange={field('baseUrl')} required placeholder="https://internal-ai.ovhcloud.tools/v1" />
          </label>
          <label>
            Clé (ANTHROPIC_API_KEY)
            <input value={edit.apiKey ?? ''} onChange={field('apiKey')} placeholder="prenom.nom@corp.ovh.com" autoComplete="off" />
          </label>
          <label>
            Jeton (ANTHROPIC_AUTH_TOKEN, facultatif)
            <input value={edit.authToken ?? ''} onChange={field('authToken')} placeholder="not-really-needed" autoComplete="off" />
          </label>
          <label>
            Délai max d’une requête, ms (API_TIMEOUT_MS)
            <input type="number" min={1000} value={edit.timeoutMs ?? 3_000_000} onChange={field('timeoutMs')} />
          </label>
          <fieldset>
            <legend>Modèles</legend>
            <label className="inline-radio">
              <input type="radio" checked={chosen === null} onChange={() => setEdit((p) => ({ ...p, models: null }))} />
              Tous ceux que l’endpoint liste (liste tenue à jour)
            </label>
            <label className="inline-radio">
              <input
                type="radio"
                checked={chosen !== null}
                onChange={() => {
                  setEdit((p) => ({ ...p, models: p?.models ?? [] }))
                  if (!found) void probe()
                }}
              />
              Seulement ceux que je coche
            </label>
            <div className="provider-probe">
              <button type="button" className="btn btn-ghost" onClick={() => void probe()} disabled={busy || !edit.baseUrl}>
                {busy ? 'Interrogation…' : 'Voir les modèles de l’endpoint'}
              </button>
              {found && <span className="muted small">{found.length} modèle(s) trouvé(s)</span>}
            </div>
            {tickable.length > 0 && (
              <div className="provider-models">
                {tickable.map((m) => (
                  <div key={m} className="provider-model">
                    <label className="inline-radio">
                      <input type="checkbox" disabled={chosen === null} checked={chosen === null || chosen.includes(m)} onChange={() => toggle(m)} />
                      {m}
                    </label>
                    <button type="button" className="text-link small" onClick={() => setExported((x) => (x === m ? null : m))} title="Les variables pour lancer Claude Code sur ce modèle dans un terminal">
                      exports
                    </button>
                  </div>
                ))}
              </div>
            )}
            {exported && edit.baseUrl && (
              <ShellSnippet title={`Claude Code sur ${exported}, dans un terminal`} text={shellExports(providerEnv({ baseUrl: edit.baseUrl, apiKey: edit.apiKey ?? '', authToken: edit.authToken ?? '', timeoutMs: Number(edit.timeoutMs) }, exported))} />
            )}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>
              Retour
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || (chosen !== null && chosen.length === 0)}>
              Enregistrer
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** Shell lines to read and copy in one click. */
export function ShellSnippet({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div className="shell-snippet">
      <div className="shell-snippet-head">
        <span className="muted small">{title}</span>
        <button type="button" className="text-link small" onClick={() => void copy()}>
          {copied ? 'Copié ✓' : 'Copier'}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  )
}
