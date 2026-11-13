import { useEffect } from 'react'
import { openSession } from './api'
import { neighbourOf } from './lib/sessions'
import { useApp } from './store'

/**
 * A menu, listbox, popover or dialog is open, or focus sits inside one: Escape and arrow keys belong to it,
 * not to the page behind.
 */
export function popupOpen() {
  if (document.querySelector('[data-open]:is([role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"])')) return true
  const active = document.activeElement
  return !!active?.closest('[data-open], [role="menu"], [role="listbox"], [aria-expanded="true"]')
}

/** Opens the previous (-1) or next (1) session in board order, muted ones skipped. */
export function goToNeighbour(dir: 1 | -1) {
  const { sessions, projects, selectedId } = useApp.getState()
  const id = neighbourOf(sessions, projects, selectedId, dir)
  if (id) openSession(id)
}

/**
 * ← / → walk from session to session, conversation open or not. Never while you write:
 * in a field only when it is empty (the caret has nowhere to go anyway), and never under a dialog.
 */
export function useSessionNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      if (useApp.getState().dialog || popupOpen()) return
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
