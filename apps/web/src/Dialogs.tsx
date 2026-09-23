import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ProjectSuggestion } from '@sangha/shared'
import { ApiError, api, openSession } from './api'
import { useApp } from './store'

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
  const [prompt, setPrompt] = useState('')
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
      const s = await api.createSession({ project, agent, prompt, baseRef: baseRef || undefined })
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
        <label>
          Consigne
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} required placeholder="Que doit faire ce prêtre ?" />
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
    <Modal title={external ? 'Renvoyer cette session de la cour ?' : 'Congédier ce prêtre ?'} onClose={onClose}>
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
            {dirty !== null ? 'Congédier quand même' : external ? 'Renvoyer' : 'Congédier'}
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
            <b>{session.external ? 'Le renvoyer de la cour' : 'Le congédier'}</b>
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
              Ses {priests} prêtre(s) seront congédiés et leurs worktrees supprimés (les branches avec des commits restent).{' '}
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

export function Dialogs() {
  const { dialog, set } = useApp()
  const close = () => set({ dialog: null })
  if (!dialog) return null
  if (dialog.kind === 'new-session') return <NewSession project={dialog.project} onClose={close} />
  if (dialog.kind === 'add-project') return <AddProject onClose={close} />
  if (dialog.kind === 'remove-project') return <RemoveProject name={dialog.name} onClose={close} />
  if (dialog.kind === 'incense') return <IncenseChoice id={dialog.id} onClose={close} />
  return <Dismiss id={dialog.id} working={dialog.working} onClose={close} />
}
