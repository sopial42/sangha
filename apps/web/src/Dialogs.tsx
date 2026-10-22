import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CostReport, NirvanaEntry, ProjectSuggestion, Provider } from '@sangha/shared'
import { ApiError, api, openSession } from './api'
import { agentTitle, formatCost, formatTime, robeOf, robeOfAgent } from './priests'
import { useApp } from './store'
import { draftOf, NEW_PRIEST_DRAFT, saveDraft } from './drafts'

/** Native modal <dialog>: focus trap, Escape and backdrop come for free. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="modal-title">
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
          <b>{session?.title}</b>
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
          <b>{session.title}</b>
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
function NoteEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [note, setNote] = useState(session?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const save = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await api.note(id, value)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Petit mot" onClose={onClose}>
      <div className="form">
        <p>
          <b>{session.title}</b>
        </p>
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
          {session.note != null && (
            <button type="button" className="btn btn-danger" onClick={() => void save(null)} disabled={busy}>
              Effacer
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void save(note.trim() || null)} disabled={busy}>
            Enregistrer
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Confirm taking a project out of the monastery (after its big burner was snuffed out). */
function RemoveProject({ name, onClose }: { name: string; onClose: () => void }) {
  const project = useApp((s) => s.projects.find((p) => p.name === name))
  const priests = useApp((s) => Object.values(s.sessions).filter((x) => x.project === name && !x.external).length)
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
          {priests > 0 && (
            <>
              Ses {priests} prêtre(s) seront envoyés au nirvana et leurs worktrees supprimés (les branches avec des commits restent).{' '}
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

/** The moon's history: every priest sent to nirvana, and a way to bring one back. */
function Nirvana({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const nirvanaTick = useApp((s) => s.nirvanaTick)
  const [entries, setEntries] = useState<NirvanaEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => api.nirvana().then(setEntries, (err) => setError(message(err)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])
  // The moon's history changed (arrival, summary written, another reincarnation): reload it live.
  useEffect(() => {
    if (entries !== null) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nirvanaTick])

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
          <ul className="nirvana-list">
            {entries.map((e) => (
              <li key={e.id} className="nirvana-entry">
                <div className="nirvana-entry-head">
                  <span className="robe-dot small-dot" style={{ background: robeOfAgent(e.agent) }} aria-hidden />
                  <b>{e.title}</b>
                  <span className="project-tag" style={{ borderColor: robeOf(e.project, projects) }}>
                    {e.project}
                  </span>
                </div>
                <p className="muted small nirvana-meta">
                  {agentTitle(e, projects)}
                  {e.branch && (
                    <>
                      {' · '}
                      <code>⎇ {e.branch}</code>
                    </>
                  )}
                  {' · '}
                  {formatTime(e.archivedAt)}
                  {e.cost != null && e.cost >= 0.01 && <> · {formatCost(e.cost)}</>}
                </p>
                <p className="nirvana-summary">{e.summary ?? <span className="muted small">résumé en cours…</span>}</p>
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
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** What every session would have cost at API prices, since monitoring began, one block per month. */
function Costs({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
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
                        <b>{m.record.title}</b> ({m.record.project}) · {formatCost(m.record.cost)} · record du mois
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

export function Dialogs() {
  const { dialog, set } = useApp()
  const close = () => set({ dialog: null })
  if (!dialog) return null
  if (dialog.kind === 'new-session') return <NewSession project={dialog.project} onClose={close} />
  if (dialog.kind === 'add-project') return <AddProject onClose={close} />
  if (dialog.kind === 'remove-project') return <RemoveProject name={dialog.name} onClose={close} />
  if (dialog.kind === 'incense') return <IncenseChoice id={dialog.id} onClose={close} />
  if (dialog.kind === 'note') return <NoteEditor id={dialog.id} onClose={close} />
  if (dialog.kind === 'nirvana') return <Nirvana onClose={close} />
  if (dialog.kind === 'costs') return <Costs onClose={close} />
  if (dialog.kind === 'providers') return <Providers onClose={close} />
  return <Dismiss id={dialog.id} working={dialog.working} onClose={close} />
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
                  <label key={m} className="inline-radio">
                    <input type="checkbox" disabled={chosen === null} checked={chosen === null || chosen.includes(m)} onChange={() => toggle(m)} />
                    {m}
                  </label>
                ))}
              </div>
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
