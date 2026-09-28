// What you were typing, kept until sent: closing the window or reloading loses nothing.
// One draft per priest (keyed by session id, Buddha included) and one for the next priest you start.
const DRAFTS_KEY = 'sangha.drafts'

/** The draft of the "new priest" form, whichever temple you open it from. */
export const NEW_PRIEST_DRAFT = 'new-priest'

const drafts = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export const draftOf = (id: string): string => drafts()[id] ?? ''

/** Keep a draft; an empty one is dropped. */
export function saveDraft(id: string, text: string) {
  const { [id]: _, ...others } = drafts()
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(text.trim() ? { ...others, [id]: text } : others))
}
