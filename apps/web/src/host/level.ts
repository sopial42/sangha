import type { HostLevel } from '@sangha/shared'

/** Colour for a host level, reusing the quota gauges' palette (jade/gold/vermilion). */
export const LEVEL_COLOR: Record<HostLevel, string> = { ok: 'var(--jade)', warn: 'var(--gold)', red: 'var(--vermilion)' }

/** In words, for titles and labels. */
export const LEVEL_LABEL: Record<HostLevel, string> = { ok: 'normal', warn: 'attention', red: 'critique' }
