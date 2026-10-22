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

/**
 * Why he stopped, as a small model read his last words: `fini` (nothing left), `question` (he needs you),
 * `attente` (something runs without you: CI, deploy, review…). Rings a different bowl for each.
 */
export type RecapState = 'fini' | 'question' | 'attente'

export type SessionRecap = { done: string; next: string; state?: RecapState }

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
  | ({ t: 'recap' } & SessionRecap)
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

/** What a priest thinks with: 'claude' (your subscription), or the id of a provider you added (e.g. OVH AI endpoints). */
export type Engine = string

/**
 * An Anthropic-compatible endpoint Claude Code can run on instead of Claude: its address and credentials, set once.
 * `models` null: every model the endpoint lists (GET {baseUrl}/models), kept current; else only those.
 */
export type Provider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  authToken: string
  timeoutMs: number
  models: string[] | null
}

/**
 * What Claude Code needs to run on a provider's model: its address and credentials, and every model alias
 * and subagent pointed at that one model. Sangha's sessions get it; you can paste it in a terminal too.
 */
export const providerEnv = (p: Pick<Provider, 'baseUrl' | 'apiKey' | 'authToken' | 'timeoutMs'>, model: string): Record<string, string> => ({
  ANTHROPIC_BASE_URL: p.baseUrl,
  ANTHROPIC_API_KEY: p.apiKey,
  ANTHROPIC_AUTH_TOKEN: p.authToken || 'not-needed',
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  CLAUDE_CODE_SUBAGENT_MODEL: model,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  API_TIMEOUT_MS: String(p.timeoutMs || 3_000_000),
})

/** An environment as `export K="V"` lines for a POSIX shell, values escaped. */
export const shellExports = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `export ${k}="${v.replace(/[\\"$`]/g, '\\$&')}"`)
    .join('\n')

/**
 * A model a session can think with. `id` is the choice's key (see modelKey); `model` null: Claude, with
 * the model of the agent's own definition.
 */
export type ModelChoice = { id: string; label: string; engine: Engine; model: string | null }

/** Key of a model choice: a Claude alias as is ('' : the agent's own), a provider's model as `provider::model`. */
export const modelKey = (engine: Engine | undefined, model: string | null | undefined) =>
  !engine || engine === 'claude' ? (model ?? '') : `${engine}::${model ?? ''}`

/** A message of yours waiting for his turn to end. */
export type QueuedMessage = { id: string; text: string; at: number }

export type SessionInfo = {
  id: string
  project: string
  agent: string
  title: string
  createdAt: number
  claudeSessionId: string | null
  /** Git branch of the session's worktree, null when the project is not a git repo. */
  branch: string | null
  /** Absent: Claude. */
  engine?: Engine
  /** The model you chose for him; null: the one of his agent's definition. */
  model?: string | null
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
  recap: SessionRecap | null
  /** A Claude Code session started outside Sangha (e.g. in a terminal). */
  external: boolean
  /** For an outside session: its `claude` process is still running (replies are relayed to it). */
  alive: boolean
  /** Incense snuffed out: he stays quiet (no glow, sound or notification) even when he waits for you. */
  silenced: boolean
  /** Your own note about him, shown under him in the courtyard (null when there is none). */
  note: string | null
  /** A standing instruction of yours (e.g. "sois concis"), recalled to him with each of your messages. */
  reminder: string | null
  /** Your messages written while he works: not read yet, sent together once his turn ends (editable until then). */
  queued: QueuedMessage[]
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
  /** The pull request of the branch checked out in his folder, once he opened one (draft included). */
  pr: PullRequest | null
  /** Scripts he left running in the background (novices excepted: see `novices`), oldest first. */
  scripts: BackgroundScript[]
}

/** An MCP server of a priest: 'disabled' = loaded but switched off, 'off' = in your Claude config, not loaded. */
export type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | 'off'
  scope: string
  error?: string
}

/** A script a priest runs in the background, and often waits on. */
export type BackgroundScript = {
  id: string
  /** As the SDK names it (e.g. "local_bash"). */
  kind: string
  /** What the SDK says about it: usually the raw command or its description. */
  command: string
  /** One short plain French sentence on what it does, written by a small model (null until written). */
  summary: string | null
  /** When Sangha first saw it running, in ms. */
  since: number
}

export type PullRequest = {
  number: number
  url: string
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  /** The branch checked out in his folder, which may differ from the one Sangha created for him. */
  branch: string
}

/** What the sessions Sangha ran cost at API prices (they run on the plan: this is what it is worth). */
export type CostReport = {
  /** Every session since monitoring began, archived ones included. */
  total: number
  sessions: number
  /** First session's creation date (monitoring start), null when there is none. */
  since: number | null
  /** Newest month first. A session counts in the month it was created. */
  months: {
    /** "2026-09" */
    month: string
    sessions: number
    cost: number
    /** Most expensive first. */
    projects: { project: string; sessions: number; cost: number }[]
    /** The month's most expensive session. */
    record: { id: string; title: string; project: string; cost: number } | null
  }[]
}

/** A priest sent to nirvana (dismissed): kept in the moon's history, and he can be reincarnated. */
export type NirvanaEntry = {
  id: string
  project: string
  agent: string
  title: string
  branch: string | null
  createdAt: number
  /** When he was sent to nirvana. */
  archivedAt: number
  cost: number | null
  /** The whole session in one or two sentences (a small model writes it; null until written). */
  summary: string | null
  /** He moved on to a fresh session: his work goes on there, nothing to reincarnate. */
  renewed: boolean
  /** The session still carrying his work on, through his fresh sessions (null when they left too). */
  continuedIn: string | null
}

/** Monastery-wide stream: every session's state, plus the plan quota. */
export type GlobalEvent =
  | { kind: 'snapshot'; sessions: SessionSummary[]; quota: Quota | null }
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'removed'; id: string }
  | { kind: 'quota'; quota: Quota }
  /** The moon's history changed (a priest arrived, a summary was written, one was reincarnated): reload it. */
  | { kind: 'nirvana' }
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

