import { useEffect, useState } from 'react'
import { api, openEvents, openSession } from './api'
import { Dialogs } from './dialogs'
import { useSessionNav } from './nav'
import { keepAudioUnlocked, watchHostSuggestions, watchSessions } from './notify'
import { useApp } from './store'
import { Board } from './app/Board'
import { FocusView } from './app/FocusView'
import { Sidebar } from './app/Sidebar'
import { TopBar } from './app/TopBar'
import { Alert, AlertAction, AlertDescription } from './components/ui/alert'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'

const SIDEBAR_KEY = 'sangha.sidebarCollapsed'

export function App() {
  const set = useApp((s) => s.set)
  const gitIdentity = useApp((s) => s.gitIdentity)
  const selectedId = useApp((s) => s.selectedId)
  const selected = useApp((s) => (s.selectedId ? s.sessions[s.selectedId] : undefined))
  const [offline, setOffline] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  useSessionNav()

  const toggleSidebar = () =>
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1')
      return !c
    })

  // ⌘B / Ctrl+B: fold the sessions list into a rail, or unfold it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    api.quotaReserve().then((reserve) => set({ reserve }), () => undefined)
    // Warms the machine chip up before the stream's first 'host' event lands; 503 (no sample yet) is ignored.
    api.host().then((host) => set({ host }), () => undefined)
    const close = openEvents(() => setOffline(true))
    const unwatch = watchSessions()
    const unwatchHost = watchHostSuggestions()
    keepAudioUnlocked()
    const session = params.get('session')
    if (session) openSession(session)
    return () => {
      close()
      unwatch()
      unwatchHost()
    }
  }, [set])

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <TopBar onToggleSidebar={toggleSidebar} />
        {offline && (
          <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
            <AlertDescription>
              Can't reach the Sangha server. Start it with <code className="font-mono">make dev</code> or <code className="font-mono">make up</code>.
            </AlertDescription>
          </Alert>
        )}
        {gitIdentity === null && (
          <Alert className="rounded-none border-x-0 border-t-0">
            <AlertDescription>Sessions can't use git until you set the identity their commits are signed with.</AlertDescription>
            <AlertAction>
              <Button size="sm" onClick={() => set({ dialog: { kind: 'git' } })}>
                Set git identity
              </Button>
            </AlertAction>
          </Alert>
        )}
        <div className="flex min-h-0 flex-1">
          <Sidebar collapsed={collapsed} />
          <main className="flex min-w-0 flex-1 flex-col">{selectedId && selected ? <FocusView s={selected} /> : <Board />}</main>
        </div>
        <Dialogs />
      </div>
    </TooltipProvider>
  )
}
