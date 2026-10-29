import { useEffect } from 'react'
import { openSession } from './api'
import { neighbourOf } from './priests'
import { useApp } from './store'

/** Opens the priest to the left (-1) or right (1) of the one shown, silenced ones skipped. */
export function goToNeighbour(dir: 1 | -1) {
  const { sessions, projects, selectedId } = useApp.getState()
  const id = neighbourOf(sessions, projects, selectedId, dir)
  if (id) openSession(id)
}

/**
 * ← / → walk the courtyard from priest to priest, conversation open or not. Never while you write:
 * in a field only when it is empty (the caret has nowhere to go anyway), and never under a dialog.
 */
export function usePriestNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      if (useApp.getState().dialog || document.querySelector('dialog[open]')) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      if (t instanceof HTMLTextAreaElement && t.value !== '') return
      e.preventDefault()
      goToNeighbour(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
