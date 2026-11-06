// What you set aside instead of sending right away, kept until you come back to it: closing the window
// or reloading loses nothing. One pile per priest (keyed by session id, Buddha included).
const STASH_KEY = 'sangha.stash'

export type StashItem = { id: string; text: string; at: number }

const piles = (): Record<string, StashItem[]> => {
  try {
    return JSON.parse(localStorage.getItem(STASH_KEY) ?? '{}') as Record<string, StashItem[]>
  } catch {
    return {}
  }
}

const save = (all: Record<string, StashItem[]>) => localStorage.setItem(STASH_KEY, JSON.stringify(all))

/** His pile, newest first. */
export const stashOf = (id: string): StashItem[] => piles()[id] ?? []

/** Puts a message on top of his pile; returns the pile as it now stands. */
export function addToStash(id: string, text: string): StashItem[] {
  const all = piles()
  const list = [{ id: crypto.randomUUID(), text, at: Date.now() }, ...(all[id] ?? [])]
  save({ ...all, [id]: list })
  return list
}

/** Takes one off his pile (reprised, sent, or discarded); returns the pile as it now stands. */
export function removeFromStash(id: string, itemId: string): StashItem[] {
  const all = piles()
  const list = (all[id] ?? []).filter((it) => it.id !== itemId)
  if (list.length) save({ ...all, [id]: list })
  else {
    const { [id]: _, ...others } = all
    save(others)
  }
  return list
}
