import { useEffect, useState } from 'react'
import { BUDDHA_SESSION_ID } from '@sangha/shared'
import { api, openMonastery, openSession } from './api'
import { Dialogs } from './Dialogs'
import { requestNotifications, watchPriests } from './notify'
import { Quota } from './quota/Quota'
import { Monastery } from './scene/Monastery'
import { SessionView } from './SessionView'
import { useApp } from './store'

export function App() {
  const set = useApp((s) => s.set)
  const projects = useApp((s) => s.projects)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    Promise.all([api.monks(), api.projects()])
      .then(([profiles, projects]) => {
        set({ profiles, projects })
        setOffline(false)
      })
      .catch(() => setOffline(true))
    const close = openMonastery(() => setOffline(true))
    const unwatch = watchPriests()
    requestNotifications()
    const session = params.get('session')
    if (session) openSession(session)
    return () => {
      close()
      unwatch()
    }
  }, [set])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ☸
          </span>
          <span className="brand-name">Sangha</span>
        </div>
        <nav className="top-actions" aria-label="Actions">
          <button className="btn btn-ghost" onClick={() => openSession(BUDDHA_SESSION_ID)}>
            ☸ Bouddha
          </button>
          <button className="btn btn-primary" onClick={() => set({ dialog: { kind: 'new-session' } })} disabled={projects.length === 0}>
            + Session
          </button>
          <button className="btn btn-ghost" onClick={() => set({ dialog: { kind: 'add-project' } })}>
            + Projet
          </button>
        </nav>
        <Quota />
      </header>
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
