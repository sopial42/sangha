import { useEffect, useState } from 'react'
import { api, openMonastery, openSession } from './api'
import { Bell } from './Bell'
import { CostChip } from './CostChip'
import { Dialogs } from './Dialogs'
import { FullscreenButton, useFullscreen } from './Fullscreen'
import { usePriestNav } from './nav'
import { keepAudioUnlocked, watchPriests } from './notify'
import { Quota } from './quota/Quota'
import { Monastery } from './scene/Monastery'
import { SessionView } from './SessionView'
import { useApp } from './store'

export function App() {
  const set = useApp((s) => s.set)
  const models = useApp((s) => s.models)
  const defaultModel = useApp((s) => s.defaultModel)
  const setDefaultModel = useApp((s) => s.setDefaultModel)
  const [offline, setOffline] = useState(false)
  const gitIdentity = useApp((s) => s.gitIdentity)
  const { full, idle } = useFullscreen()
  usePriestNav()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    Promise.all([api.monks(), api.projects()])
      .then(([profiles, projects]) => {
        set({ profiles, projects })
        setOffline(false)
      })
      .catch(() => setOffline(true))
    api.models().then((models) => set({ models }), () => undefined)
    api.gitIdentity().then((gitIdentity) => set({ gitIdentity }), () => undefined)
    const close = openMonastery(() => setOffline(true))
    const unwatch = watchPriests()
    keepAudioUnlocked()
    const session = params.get('session')
    if (session) openSession(session)
    return () => {
      close()
      unwatch()
    }
  }, [set])

  return (
    <div className={`app${full ? ' is-fullscreen' : ''}${full && idle ? ' is-idle' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ☸
          </span>
          <span className="brand-name">Sangha</span>
          <CostChip onOpen={() => set({ dialog: { kind: 'costs' } })} />
          {models.length > 0 && (
            <select
              className="model-pick"
              value={models.some((m) => m.id === defaultModel) ? defaultModel : ''}
              onChange={(e) => setDefaultModel(e.target.value)}
              aria-label="Modèle des nouvelles sessions"
              title="Modèle des nouvelles sessions (modifiable à chaque lancement)"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost" onClick={() => set({ dialog: { kind: 'providers' } })} title="Ajouter un endpoint de modèles (ex. OVH) à la place de Claude">
            Fournisseurs
          </button>
          <button
            className={`btn btn-ghost ${gitIdentity === null ? 'btn-needed' : ''}`}
            onClick={() => set({ dialog: { kind: 'git' } })}
            title={gitIdentity ? `Les prêtres commitent en tant que ${gitIdentity.name} <${gitIdentity.email}>` : 'Identité git des commits : à renseigner'}
          >
            Git{gitIdentity === null && ' ⚠'}
          </button>
        </div>
        <Quota />
        <Bell />
        <FullscreenButton full={full} />
      </header>
      {gitIdentity === null && (
        <p className="banner banner-action" role="alert">
          Les prêtres ne peuvent pas utiliser git tant que l'identité des commits n'est pas renseignée.
          <button type="button" className="btn btn-primary" onClick={() => set({ dialog: { kind: 'git' } })}>
            Renseigner
          </button>
        </p>
      )}
      {offline && (
        <p className="banner" role="alert">
          Serveur injoignable. Lance <code>make dev</code> ou <code>make up</code>.
        </p>
      )}
      <main className="stage">
        <div className="scene-wrap">
          <Monastery />
        </div>
      </main>
      <SessionView />
      <Dialogs />
    </div>
  )
}
