import { BUDDHA_SESSION_ID, type ProjectInfo, type PullRequest, type SessionStatus, type SessionSummary } from '@sangha/shared'

const DEFAULT_ROBE = '#c2703d'

export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'médite',
  waiting: 'attend ton input',
  idle: 'au repos',
  error: 'en difficulté',
  interrupted: 'interrompu',
}

// Robes tell the agent, not the project (the pavilion does that): a given agent always wears the same.
const AGENT_ROBES = ['#c2703d', '#8e2f2f', '#b8860b', '#7a4f8e', '#a0522d', '#3f7f7a', '#9c6b98', '#6b8e4e']
// Sessions may still carry an old agent id ('chat', 'review') from before those roles were removed;
// robeOfAgent and agentTitle fall back to the generic hash/pretty-print, so they render fine, unlabeled.
const FIXED_ROBES: Record<string, string> = { lead: '#c2703d', claude: '#c2703d' }

export function robeOfAgent(agent: string): string {
  if (FIXED_ROBES[agent]) return FIXED_ROBES[agent]
  const hash = [...agent].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return AGENT_ROBES[hash % AGENT_ROBES.length]!
}

const pretty = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Context weight: fine under 200K, heavy from 200K, rotting from 400K. */
export const contextLevel = (tokens: number | null) => (tokens == null ? null : tokens >= 400_000 ? 'rotting' : tokens >= 200_000 ? 'heavy' : 'fine')
export const CONTEXT_COLOR = { fine: '#6fae8a', heavy: '#e0a33a', rotting: '#c0392b' } as const
export const formatTokens = (t: number) => `${Math.round(t / 1000)}K`

/** A PR's state, in one word for the courtyard's small chip (open stays "PR": the colour already says it's live). */
export const PR_CHIP_WORD: Record<PullRequest['state'], string> = { open: 'PR', draft: 'brouillon', merged: 'fusionnée', closed: 'fermée' }
/** The fuller word for the same state, used in SessionView's chip and in full titles/tooltips. */
export const PR_STATE_WORD: Record<PullRequest['state'], string> = { open: 'ouverte', draft: 'brouillon', merged: 'fusionnée', closed: 'fermée' }
/** Tuned against the courtyard's dark parchment background and its existing palette (jade/muted/vermilion + one purple for "merged"). */
export const PR_COLOR: Record<PullRequest['state'], string> = { open: '#6fae8a', draft: '#b3a38e', merged: '#9c6b98', closed: '#a85a4f' }
/** Full sentence for a PR's <title>/aria-label, everywhere it appears. */
export const prFullLabel = (pr: PullRequest) => `PR #${pr.number} (${PR_STATE_WORD[pr.state]}) : ${pr.title} — ${pr.branch}`
/** Dollars, to the cent below 100 $, to the dollar above. */
/** When a message was said: "14:05" today, "23 sept. 14:05" before. Nothing when unknown. */
export function formatTime(at: number) {
  if (!at) return ''
  const d = new Date(at)
  const time = d.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('fr', { day: 'numeric', month: 'short' })} ${time}`
}

// A non-breaking space before the currency sign: narrow layouts (the mobile Nirvana dialog…) never
// split the amount from its "$" onto its own line.
export const formatCost = (usd: number) => (usd < 100 ? `${usd.toFixed(2)} $` : `${Math.round(usd).toLocaleString('fr-FR')} $`)

/** How long ago, coarsely, in French: "à l'instant", "il y a 5 min", "il y a 3 h", "il y a 12 j". */
export function formatAge(at: number): string {
  const s = Math.max(0, Date.now() - at) / 1000
  if (s < 60) return "à l'instant"
  const min = Math.round(s / 60)
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.round(h / 24)} j`
}

/** A path under the user's home directory, shortened to `~/…` (best guess from common home layouts). */
export function shortenPath(path: string): string {
  const m = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)?$/)
  return m ? `~${m[2] ?? ''}` : path
}

export const robeOf = (project: string, projects: ProjectInfo[]) => projects.find((p) => p.name === project)?.color ?? DEFAULT_ROBE

export function agentTitle(s: Pick<SessionSummary, 'agent' | 'project'>, projects: ProjectInfo[]): string {
  if (s.agent === 'buddha') return 'Bouddha'
  if (s.agent === 'claude') return 'Claude'
  return projects.find((p) => p.name === s.project)?.agents.find((a) => a.id === s.agent)?.title ?? pretty(s.agent)
}

/** Priests in the courtyard: every session but Buddha, oldest first. */
export const priestsOf = (sessions: Record<string, SessionSummary>) =>
  Object.values(sessions)
    .filter((s) => s.id !== BUDDHA_SESSION_ID)
    .sort((a, b) => a.createdAt - b.createdAt)
