import type { Store } from './db'

/** The session still at work on what `id` started, following his fresh sessions; null if they all left too. */
export function carriedOnIn(store: Store, id: string): string | null {
  const seen = new Set([id])
  for (let next = store.successor(id); next && !seen.has(next); next = store.successor(next)) {
    seen.add(next)
    const row = store.getSession(next)
    if (!row) return null
    if (!row.archivedAt) return next
  }
  return null
}
