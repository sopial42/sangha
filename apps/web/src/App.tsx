import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, openEvents, openSession } from './api'
import { Dialogs } from './dialogs'
import { currentId } from './lib/legacy'
import { useSessionNav } from './nav'
import { keepAudioUnlocked, watchHostSuggestions, watchSessions } from './notify'
import { useApp } from './store'
import { Board } from './app/Board'
import { Sidebar } from './app/Sidebar'
import { TopBar } from './app/TopBar'
import { Alert, AlertAction, AlertDescription } from './components/ui/alert'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'
import { PHONE, useMedia } from './lib/useMedia'

const SIDEBAR_KEY = 'sangha.sidebarCollapsed'

// The session view (conversation, markdown, session cards) loads on first open: the board shows without it.
const FocusView = lazy(() => import('./app/FocusView').then((m) => ({ default: m.FocusView })))

export function App() {
  const set = useApp((s) => s.set)
  const gitIdentity = useApp((s) => s.gitIdentity)
  const selectedId = useApp((s) => s.selectedId)
  const selected = useApp((s) => (s.selectedId ? s.sessions[s.selectedId] : undefined))
  const [offline, setOffline] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  useSessionNav()

  // On a phone the sidebar is always a rail, and the full list opens as a drawer over the page.
  const phone = useMedia(PHONE)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => setDrawer(false), [selectedId, phone])
  const phoneRef = useRef(phone)
  phoneRef.current = phone
  // Escape closes the drawer first (capture phase: before the session view's own Escape).
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setDrawer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawer])

  const toggleSidebar = () => {
    if (phoneRef.current) return setDrawer((d) => !d)
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1')
      return !c
    })
  }

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
    Promise.all([api.subagents(), api.projects()])
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
    if (session) openSession(currentId(session))
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
          <Sidebar collapsed={collapsed || phone} />
          {phone && drawer && (
            <div className="fixed inset-0 z-40 flex">
              <button type="button" aria-label="Close sessions" className="absolute inset-0 bg-black/50 transition-opacity duration-200 starting:opacity-0" onClick={() => setDrawer(false)} />
              <div className="relative flex h-full shadow-2xl motion-drawer">
                <Sidebar collapsed={false} />
              </div>
            </div>
          )}
          <main className="flex min-w-0 flex-1 flex-col">{selectedId && selected ? (
              <Suspense fallback={null}>
                <FocusView s={selected} />
              </Suspense>
            ) : (
              <Board />
            )}</main>
        </div>
        <Dialogs />
      </div>
    </TooltipProvider>
  )
}
