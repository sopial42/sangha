// Contract between server and web. The server turns raw Agent SDK messages
// into MonasteryEvents; the web only ever sees these.

export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type QuotaWindow = { utilization: number; resetsAt: number | null } // utilization 0..1, resetsAt epoch seconds

export type Quota = {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  fiveHour: QuotaWindow | null
  sevenDay: QuotaWindow | null
}

export type MonkStatus = 'working' | 'completed' | 'failed' | 'stopped'

export type MonasteryEvent =
  | { t: 'session.started'; model: string; agents: string[]; skills: string[]; plugins: string[]; claudeSessionId: string }
  | { t: 'user.message'; text: string }
  | { t: 'buddha.delta'; text: string }
  | { t: 'buddha.text'; text: string }
  | { t: 'buddha.tool'; tool: string; summary: string }
  | { t: 'monk.summoned'; monkId: string; agentType: string; description: string; prompt: string; depth: number }
  | { t: 'monk.tool'; monkId: string; tool: string; summary: string }
  | { t: 'monk.text'; monkId: string; text: string }
  | { t: 'monk.progress'; monkId: string; description: string; tokens: number; toolUses: number }
  | { t: 'monk.done'; monkId: string; status: Exclude<MonkStatus, 'working'>; summary: string }
  | { t: 'turn.done'; ok: boolean; costUsdEquiv: number; durationMs: number; usage: Usage }
  | { t: 'quota'; quota: Quota }
  | { t: 'busy'; busy: boolean }
  /** Background work still running (a script launched in the background, a novice…): the full set, replacing the last one. */
  | { t: 'background'; tasks: { id: string; type: string; description: string }[] }
  /** Micro recap written when a priest stops: what was done, what is left (or awaited from you). */
  | { t: 'recap'; done: string; next: string }
  | { t: 'error'; message: string }

/** An event as stored and streamed: numbered per session, timestamped. */
export type Envelope = { seq: number; at: number; ev: MonasteryEvent }

/**
 * What a priest is. Either the Sangha role (lead) or an agent defined by the
 * project itself in .claude/agents (e.g. kiat-team-lead), run as the session's main thread.
 */
export type AgentOption = {
  id: string
  title: string
  description: string
  source: 'sangha' | 'project'
  model: string | null
}

/** A git repository (or plain folder) under workspaces/. Its color dyes its priests' robes. */
export type ProjectInfo = {
  name: string
  /** Absolute path: under workspaces/, or anywhere on this machine for a local project. */
  path: string
  local: boolean
  color: string
  isGit: boolean
  branch: string | null
  agents: AgentOption[]
}

/** A git repository where Claude Code ran recently, offered as a project. */
export type ProjectSuggestion = { name: string; path: string; lastUsed: number }

/** The single Buddha: a dispatcher session that can start and follow priests for you. */
export const BUDDHA_SESSION_ID = 'buddha'

export type SessionInfo = {
  id: string
  project: string
  agent: string
  title: string
  createdAt: number
  claudeSessionId: string | null
  /** Git branch of the session's worktree, null when the project is not a git repo. */
  branch: string | null
}

/**
 * working: the priest meditates (Claude is running).
 * waiting: he opened his eyes, finished and you have not looked yet.
 * idle: done and seen. error: last turn failed. interrupted: the server stopped mid-work.
 */
export type SessionStatus = 'working' | 'waiting' | 'idle' | 'error' | 'interrupted'

export type NoviceSummary = { monkId: string; agentType: string; description: string; lastTool: { tool: string; summary: string } | null }

export type SessionSummary = SessionInfo & {
  status: SessionStatus
  /** The priest's own current tool, if any. */
  activity: string | null
  /** While he works: what he is doing overall, in one short sentence (a small model's summary). */
  doing: string | null
  novices: NoviceSummary[]
  /** Recap of his last piece of work, while he waits for you. */
  recap: { done: string; next: string } | null
  /** A Claude Code session started outside Sangha (e.g. in a terminal). */
  external: boolean
  /** For an outside session: its `claude` process is still running (replies are relayed to it). */
  alive: boolean
  /** Incense snuffed out: he stays quiet (no glow, sound or notification) even when he waits for you. */
  silenced: boolean
  /** Tokens his context weighs, as of his latest reply (null until known). */
  context: number | null
  /** What the session would have cost at API prices, in dollars, novices and earlier sessions it took over from included. */
  cost: number | null
  /** Moving on to a fresh session: asked and awaiting his answer, or postponed (asked again 100K later). */
  renewal: 'asked' | 'postponed' | null
  /** Buddha sees him through to a fresh session: when he asks next, or that he awaits the answer, or was refused. */
  shepherd: { state: 'pending' | 'asked' | 'refused'; nextAt: number; note: string | null } | null
  /** Folder the session works in (its worktree, or the project itself). */
  cwd: string | null
}

/** Monastery-wide stream: every session's state, plus the plan quota. */
export type GlobalEvent =
  | { kind: 'snapshot'; sessions: SessionSummary[]; quota: Quota | null }
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'removed'; id: string }
  | { kind: 'quota'; quota: Quota }
  /** Projects were added or removed: reload them. */
  | { kind: 'projects' }

/** Visual identity of a novice (subagent), served by the server so web and agent config stay in one place. */
export type MonkProfile = {
  agentType: string
  name: string
  role: string
  robe: string // CSS color
  model: string
}
