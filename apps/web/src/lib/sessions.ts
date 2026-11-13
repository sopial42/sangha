import { BUDDHA_SESSION_ID, type ProjectInfo, type SessionSummary } from '@sangha/shared'
import type { SpriteKey } from '@/assets/pebbles'

/** Where a session sits in the sidebar, and how loud it is on the board. */
export type Group = 'needs' | 'working' | 'idle'

/** Needs you: finished and unread, or failed. A silenced session never asks for attention. */
export const needsYou = (s: SessionSummary) => !s.silenced && (s.status === 'waiting' || s.status === 'error')

export function groupOf(s: SessionSummary): Group {
  if (needsYou(s)) return 'needs'
  if (s.status === 'working') return 'working'
  return 'idle'
}

export type Ring = 'needs' | 'error' | 'glow' | null

/** Context weight as cairn stones: none under 100K, then 1, 3, and 5 past the 400K "start fresh" mark. */
export function cairnOf(context: number | null): 0 | 1 | 3 | 5 {
  if (context == null || context < 100_000) return 0
  if (context < 200_000) return 1
  if (context < 400_000) return 3
  return 5
}

export const FRESH_START_AT = 400_000

/**
 * The pebble for a session. Colour means attention: coral only when it needs you, stone otherwise.
 * Only an idle pebble sits on its cairn (the sprites with stones are drawn with open eyes).
 */
export function pebbleOf(s: SessionSummary, icon = false): { sprite: SpriteKey; ring: Ring } {
  const prefix = icon ? 'icon-' : ''
  if (needsYou(s) && s.status === 'waiting') return { sprite: `${prefix}coral-up` as SpriteKey, ring: 'needs' }
  if (s.status === 'error') return { sprite: `${prefix}stone-x` as SpriteKey, ring: s.silenced ? null : 'error' }
  if (s.status === 'working') return { sprite: `${prefix}stone-closed` as SpriteKey, ring: 'glow' }
  if (s.status === 'interrupted') return { sprite: `${prefix}stone-flat` as SpriteKey, ring: null }
  const cairn = icon ? 0 : cairnOf(s.context)
  // No 5-stone sprite at 3, and no 3-stone at 1: the closest one that exists.
  if (cairn === 5) return { sprite: 'stone-open-cairn5', ring: null }
  if (cairn === 3) return { sprite: 'stone-open-cairn3', ring: null }
  if (cairn === 1) return { sprite: 'stone-open-cairn1', ring: null }
  return { sprite: `${prefix}stone-open` as SpriteKey, ring: null }
}

/** Every session but the orchestrator, oldest first. */
export const sessionsOf = (all: Record<string, SessionSummary>) =>
  Object.values(all)
    .filter((s) => s.id !== BUDDHA_SESSION_ID)
    .sort((a, b) => a.createdAt - b.createdAt)

/** How a session is named: your note when you wrote one, its title otherwise. */
export const nameOf = (s: Pick<SessionSummary, 'note' | 'title'>) => s.note || s.title

const pretty = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function agentName(s: Pick<SessionSummary, 'agent' | 'project'>, projects: ProjectInfo[]): string {
  if (s.agent === 'buddha') return 'Orchestrator'
  if (s.agent === 'claude' || s.agent === 'lead') return 'Claude'
  return projects.find((p) => p.name === s.project)?.agents.find((a) => a.id === s.agent)?.title ?? pretty(s.agent)
}

/** One short line under a session's name: what it's doing or waiting for. */
export function statusLine(s: SessionSummary): string {
  switch (s.status) {
    case 'waiting':
      return s.recap?.state === 'question' ? 'Has a question' : s.recap?.state === 'attente' ? 'Waiting for you' : 'Done, unread'
    case 'error':
      return 'Error'
    case 'interrupted':
      return 'Interrupted'
    case 'working':
      if (s.novices.length > 1) return `${s.novices.length} subagents`
      return s.doing ?? s.activity ?? 'Working'
    case 'idle':
      return s.context != null && s.context >= FRESH_START_AT ? `Idle · ${formatTokens(s.context)}` : 'Idle'
  }
}

export const formatTokens = (t: number) => (t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : `${Math.round(t / 1000)}K`)

export function formatCost(usd: number) {
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`
}

export function ago(at: number | null, now = Date.now()): string {
  if (!at) return 'now'
  const s = Math.max(0, now - at) / 1000
  if (s < 60) return 'now'
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

export function duration(from: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - from) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${Math.round(h / 24)} d`
}

export function shortenPath(path: string): string {
  const m = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/)
  return m ? `~${m[2] ?? ''}` : path
}

/**
 * `list` with each session's headless children (its `parent`, when also in `list`) moved right after
 * it, grandchildren after their own parent in turn. A child whose launcher isn't in `list` keeps its place.
 */
export function groupChildren<T extends { id: string; parent?: string | null }>(list: T[]): T[] {
  const byParent = new Map<string | null, T[]>()
  for (const s of list) {
    const key = s.parent && list.some((x) => x.id === s.parent) ? s.parent : null
    const siblings = byParent.get(key)
    if (siblings) siblings.push(s)
    else byParent.set(key, [s])
  }
  const emit = (parent: string | null): T[] => (byParent.get(parent) ?? []).flatMap((s) => [s, ...emit(s.id)])
  return emit(null)
}

/** Every session in the board's order: project by project, children right after their parent. */
export function boardOrder(all: Record<string, SessionSummary>, projects: ProjectInfo[]): SessionSummary[] {
  const list = sessionsOf(all).filter((s) => !s.lotus)
  const names = projects.map((p) => p.name)
  for (const s of list) if (!names.includes(s.project)) names.push(s.project)
  return names.flatMap((n) => groupChildren(list.filter((s) => s.project === n)))
}

/** The session after (`dir` 1) or before (-1) `from` in board order, looping, muted ones skipped. */
export function neighbourOf(all: Record<string, SessionSummary>, projects: ProjectInfo[], from: string | null, dir: 1 | -1): string | null {
  const order = boardOrder(all, projects).filter((s) => !s.silenced || s.id === from)
  const i = order.findIndex((s) => s.id === from)
  if (i < 0) return (dir === 1 ? order[0] : order.at(-1))?.id ?? null
  const next = order[(i + dir + order.length) % order.length]!
  return next.id === from ? null : next.id
}
