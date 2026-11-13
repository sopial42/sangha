import type { HostLevel, SessionStatus } from '@sangha/shared'

/** Colour for a host level, as a CSS value (for SVG strokes and inline styles). */
export const LEVEL_COLOR: Record<HostLevel, string> = { ok: 'var(--foreground)', warn: 'var(--amber)', red: 'var(--danger)' }

/** Text colour class for a host level. */
export const LEVEL_TEXT: Record<HostLevel, string> = { ok: 'text-foreground', warn: 'text-amber', red: 'text-danger' }

/** Fill colour class for a host level (gauge segments). */
export const LEVEL_BG: Record<HostLevel, string> = { ok: 'bg-foreground', warn: 'bg-amber', red: 'bg-danger' }

/** In words, for titles and labels. */
export const LEVEL_LABEL: Record<HostLevel, string> = { ok: 'normal', warn: 'warning', red: 'critical' }

/** A session's status in a word, for the machine report. */
export const STATUS_WORD: Record<SessionStatus, string> = {
  working: 'working',
  waiting: 'waiting for you',
  idle: 'idle',
  error: 'error',
  interrupted: 'interrupted',
}

/** Bytes in KB under 1 MB, MB under 1 GB, GB above (one decimal). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** How long something has lasted, coarsely: "under a minute", "5 min", "3 h", "2 d". */
export function formatSpan(at: number, now = Date.now()): string {
  const s = Math.max(0, now - at) / 1000
  if (s < 60) return 'under a minute'
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}
