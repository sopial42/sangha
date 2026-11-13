import { useSyncExternalStore } from 'react'

/** Whether a media query matches, kept live (e.g. `useMedia('(max-width: 767px)')`). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** Below this, the sidebar folds into a rail and opens as a drawer. */
export const PHONE = '(max-width: 767px)'
/** Below this, the session details open over the conversation instead of beside it. */
export const NARROW = '(max-width: 1279px)'
