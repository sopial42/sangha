import { withCurrentIds } from './lib/legacy'

// What you were typing, kept until sent: closing the window or reloading loses nothing.
// One draft per session (keyed by session id, the Orchestrator included) and one for the next session you start.
const DRAFTS_KEY = 'sangha.drafts'

/** The draft of the "new session" form, whichever project you open it from. */
export const NEW_SESSION_DRAFT = 'new-session'

const drafts = (): Record<string, string> => {
  try {
    return withCurrentIds(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>)
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
