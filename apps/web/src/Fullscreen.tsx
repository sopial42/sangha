import { useEffect, useState } from 'react'

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

// Chrome's Keyboard Lock: in full screen, Escape reaches the page (to close a conversation) instead of
// leaving full screen at once; holding it still leaves. Elsewhere (Safari) Escape stays the browser's.
type KeyboardLock = { lock?: (keys: string[]) => Promise<void> }
const lockEscape = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.lock?.(['Escape']).catch(() => undefined)

export const toggleFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
  else document.documentElement.requestFullscreen().then(lockEscape, () => undefined)
}

// Something Escape closes first: a conversation, a dialog, the bell's list.
const somethingOpen = () => !!document.querySelector('.overlay, dialog[open], .bell-popover')

/**
 * Whether Sangha fills the screen, and for how long the pointer has rested. Like a film player: in full
 * screen the top bar and the cursor fade out after a few still seconds, back as soon as you move.
 * F toggles it (not while typing). Escape closes what is open first, and leaves only once nothing is.
 */
export function useFullscreen(idleMs = 2500) {
  const [full, setFull] = useState(() => !!document.fullscreenElement)
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement)
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      e.preventDefault()
      toggleFullscreen()
    }
    // Capture phase: decided before the conversation's own Escape closes it, so one press does one thing.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.fullscreenElement && !somethingOpen()) document.exitFullscreen().catch(() => undefined)
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onEscape, true)
    }
  }, [])

  useEffect(() => {
    setIdle(false)
    if (!full) return
    let timer = setTimeout(() => setIdle(true), idleMs)
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), idleMs)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [full, idleMs])

  return { full, idle }
}

/** Top bar button: four corners opening out, or folding back in once in full screen. */
export function FullscreenButton({ full }: { full: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn-ghost fullscreen-btn ${full ? 'active' : ''}`}
      onClick={toggleFullscreen}
      aria-pressed={full}
      aria-label={full ? 'Quitter le plein écran' : 'Plein écran'}
      title={full ? 'Quitter le plein écran (F ou Échap)' : 'Plein écran (F)'}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        {full ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
    </button>
  )
}
