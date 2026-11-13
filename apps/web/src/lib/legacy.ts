import { ORCHESTRATOR_SESSION_ID } from '@sangha/shared'

/**
 * Ids older versions used, still found in bookmarked URLs (`?session=buddha`) and in this browser's saved
 * drafts and stash: the orchestrator's old id, and the old key of the new-session draft.
 */
const LEGACY_IDS: Record<string, string> = { buddha: ORCHESTRATOR_SESSION_ID, 'new-priest': 'new-session' }

/** The current id for one that may come from an older version. */
export const currentId = (id: string) => LEGACY_IDS[id] ?? id

/** Moves entries kept under a legacy id to the current one (the current one wins if both exist). */
export function withCurrentIds<T>(all: Record<string, T>): Record<string, T> {
  for (const [old, id] of Object.entries(LEGACY_IDS)) {
    if (!(old in all)) continue
    if (!(id in all)) all[id] = all[old]!
    delete all[old]
  }
  return all
}
