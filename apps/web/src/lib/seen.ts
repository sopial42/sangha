/**
 * What the board has already shown, so animations only play for real changes: a session that just
 * arrived, a pebble whose state just changed, a project that just started calling you. Coming back to
 * the board (Esc, a click) replays nothing, except what changed while you were away.
 *
 * Module-level on purpose: it outlives the board's own mounts. Each change stays "fresh" for a short
 * window, so a re-render in the middle of an animation (a hover, a stream update) doesn't cut it short.
 */
type Change = 'new' | 'changed'
type Entry = { value: string; at: number; kind: Change }

const FRESH_MS = 1200
const seen = new Map<string, Entry>()
let primed = false

/** First real data: remember it all as already seen, so the first paint doesn't animate everything. */
export function primeSeen(entries: Iterable<[string, string]>) {
  if (primed) return
  for (const [key, value] of entries) seen.set(key, { value, at: 0, kind: 'changed' })
  primed = true
}

export const isPrimed = () => primed

/** Whether `key` just appeared or just took a new `value` (within the fresh window), and remember it. */
export function changeOf(key: string, value: string, now = Date.now()): Change | null {
  const entry = seen.get(key)
  if (!entry) {
    seen.set(key, { value, at: now, kind: 'new' })
    return primed ? 'new' : null
  }
  if (entry.value !== value) {
    entry.value = value
    entry.at = now
    entry.kind = 'changed'
  }
  return now - entry.at < FRESH_MS ? entry.kind : null
}
