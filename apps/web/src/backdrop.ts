import { useRef, type MouseEvent } from 'react'

/**
 * Close on a click on the backdrop itself, and only one that also began there: a text selection started in the
 * window and released outside of it is no click to close, the window stays open with its selection.
 */
export function useBackdropClose(close: () => void) {
  const downOnBackdrop = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => {
      downOnBackdrop.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) close()
      downOnBackdrop.current = false
    },
  }
}
