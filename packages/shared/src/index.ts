// Contract between server and web. The server turns raw Agent SDK messages
// into SessionEvents; the web only ever sees these.

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

/**
 * The share of the plan quota Sangha keeps untouched: once the week's usage passes 100 - pct %,
 * sessions are held (running turns interrupted, messages queued, tools refused) until it starts afresh,
 * the reserve is lowered, or switched off.
 */
export type QuotaReserve = { enabled: boolean; pct: number }

/** The reserve as set, plus whether it bites right now (always on the week: the only window left). */
export type QuotaReserveState = QuotaReserve & { reached: boolean; window: 'sevenDay' | null }

export type SubagentStatus = 'working' | 'completed' | 'failed' | 'stopped'

/**
 * Why a session stopped, as a small model read its last words: `done` (nothing left), `question`
 * (it needs you), `waiting` (waiting on something that runs without you: CI, deploy, review…). Each plays a
 * different sound. Older databases stored French values: `Store` migrates them once at startup.
 */
export type RecapState = 'done' | 'question' | 'waiting'

export type SessionRecap = { done: string; next: string; state?: RecapState }

export type SessionEvent =
  | { t: 'session.started'; model: string; agents: string[]; skills: string[]; plugins: string[]; claudeSessionId: string }
  | { t: 'user.message'; text: string }
  | { t: 'assistant.delta'; text: string }
  | { t: 'assistant.text'; text: string }
  | { t: 'assistant.tool'; tool: string; summary: string }
  /** The session's own `/loop` machinery firing or ending (ScheduleWakeup, CronCreate, CronDelete): what `SessionSummary.autonomy`'s loop derivation reads. `nextAt`: its next scheduled wake-up, epoch ms, when known. */
  | { t: 'loop.wake'; nextAt: number | null; stop: boolean }
  | { t: 'subagent.started'; subagentId: string; agentType: string; description: string; prompt: string; depth: number }
  | { t: 'subagent.tool'; subagentId: string; tool: string; summary: string }
  | { t: 'subagent.text'; subagentId: string; text: string }
  | { t: 'subagent.progress'; subagentId: string; description: string; tokens: number; toolUses: number }
  | { t: 'subagent.done'; subagentId: string; status: Exclude<SubagentStatus, 'working'>; summary: string }
  | { t: 'turn.done'; ok: boolean; costUsdEquiv: number; durationMs: number; usage: Usage }
  | { t: 'quota'; quota: Quota }
  | { t: 'busy'; busy: boolean }
  /** Background work still running (a script launched in the background, a subagent…): the full set, replacing the last one. */
  | { t: 'background'; tasks: { id: string; type: string; description: string }[] }
  /** Micro recap written when a session stops: what was done, what is left (or awaited from you). */
  | ({ t: 'recap' } & SessionRecap)
  | { t: 'error'; message: string }
  /** An MCP tool failed on the main thread (never a subagent's): what the Advisor aggregates per server. */
  | { t: 'tool.error'; tool: string; server: string; message: string }

/** An event as stored and streamed: numbered per session, timestamped. */
export type Envelope = { seq: number; at: number; ev: SessionEvent }

/**
 * What a session runs as. Either the Sangha role (lead) or an agent defined by the
 * project itself in .claude/agents (e.g. kiat-team-lead), run as the session's main thread.
 */
export type AgentOption = {
  id: string
  title: string
  description: string
  source: 'sangha' | 'project'
  model: string | null
}

/** A git repository (or plain folder) under workspaces/. */
export type ProjectInfo = {
  name: string
  /** Absolute path: under workspaces/, or anywhere on this machine for a local project. */
  path: string
  local: boolean
  isGit: boolean
  branch: string | null
  agents: AgentOption[]
}

/** A git repository where Claude Code ran recently, offered as a project. */
export type ProjectSuggestion = { name: string; path: string; lastUsed: number }

/** The single orchestrator: a dispatcher session that can start and follow sessions for you. */
export const ORCHESTRATOR_SESSION_ID = 'orchestrator'

/** What a session thinks with: 'claude' (your subscription), or the id of a provider you added (e.g. OVH AI endpoints). */
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

/** A message of yours waiting for the session's turn to end. */
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
  /** The model you chose for it; null: the one from its agent's definition. */
  model?: string | null
}

/**
 * working: the session is working (Claude is running).
 * waiting: it finished and you have not looked yet.
 * idle: done and seen. error: last turn failed. interrupted: the server stopped mid-work.
 */
export type SessionStatus = 'working' | 'waiting' | 'idle' | 'error' | 'interrupted'

export type SubagentSummary = { subagentId: string; agentType: string; description: string; lastTool: { tool: string; summary: string } | null }

/** See `SessionSummary.autonomy`. */
export type AutonomyState =
  | { mode: 'goal'; text: string; active: boolean }
  | { mode: 'loop'; text: string; interval: string | null; nextAt: number | null; active: boolean }

export type SessionSummary = SessionInfo & {
  status: SessionStatus
  /** The session's own current tool, if any. */
  activity: string | null
  /** While it works: what it is doing overall, in one short sentence (a small model's summary). */
  doing: string | null
  subagents: SubagentSummary[]
  /** Recap of its last piece of work, while it waits for you. */
  recap: SessionRecap | null
  /** A Claude Code session started outside Sangha (e.g. in a terminal). */
  external: boolean
  /** For an outside session: its `claude` process is still running (replies are relayed to it). */
  alive: boolean
  /** Muted: it stays quiet (no highlight, sound or notification) even when it waits for you. */
  silenced: boolean
  /** Set aside: kept in a separate stack on the board instead of with its project. */
  setAside: boolean
  /** Your own note about it, shown with it on the board (null when there is none). */
  note: string | null
  /** A standing instruction of yours (e.g. "be concise"), recalled to it with each of your messages. */
  reminder: string | null
  /**
   * Its autonomy, the one engine that keeps it going on its own (never both at once):
   * - `goal`: Claude Code `/goal <text>`, turn after turn until it is met;
   * - `loop`: Claude Code `/loop [interval] <text>`, waking itself up again and again
   *   (`interval` as typed, e.g. "5m", null when it paces itself; `nextAt`: its next scheduled wake-up, epoch ms, if known).
   * `active: false` once stopped (by you, an interruption, or a loop it no longer reschedules): kept so it
   * can be relaunched or edited. Null when it never had one.
   */
  autonomy: AutonomyState | null
  /** Its own environment variables, set by you; its process starts with them. */
  env: Record<string, string>
  /** Your messages written while it works: not read yet, sent together once its turn ends (editable until then). */
  queued: QueuedMessage[]
  /** Tokens its context weighs, as of its latest reply (null until known). */
  context: number | null
  /** What the session would have cost at API prices, in dollars, subagents and earlier sessions it took over from included. */
  cost: number | null
  /** Starting fresh in a new session: asked and awaiting its answer, or postponed (asked again 100K later). */
  renewal: 'asked' | 'postponed' | null
  /** The orchestrator hands it off to a fresh session: when it asks next, or that it awaits the answer, or was refused. */
  handoff: { state: 'pending' | 'asked' | 'refused'; nextAt: number; note: string | null } | null
  /** Folder the session works in (its worktree, or the project itself). */
  cwd: string | null
  /** The pull request of the branch checked out in its folder, once it opened one (draft included). */
  pr: PullRequest | null
  /** Scripts it left running in the background (subagents excepted: see `subagents`), oldest first. */
  scripts: BackgroundScript[]
  /** While its conversation is driven from claude.ai: the Remote Control link (Sangha's own process stays off). */
  remote?: string | null
  /** You asked for Remote Control while it worked: it starts by itself once its turn ends (nothing is cut). */
  remotePending?: boolean
  /** The session whose process launched this one (a headless `claude -p` started from its shell); null/absent for a top-level session. */
  parent?: string | null
}

/** An MCP server of a session: 'disabled' = loaded but switched off, 'off' = in your Claude config, not loaded. */
export type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | 'off'
  scope: string
  error?: string
  /** Its switch for all of Sangha. */
  global: boolean
  /** This session's own switch, when it overrides the one for all of Sangha. */
  session?: boolean
}

/** An MCP server as switched for all of Sangha (each session can override it). */
export type GlobalMcp = { name: string; scope: string; enabled: boolean }

/** A value a library server needs: secrets are never sent back, only whether they are set. */
export type LibraryField = { key: string; label: string; secret: boolean; optional: boolean; placeholder?: string; set: boolean; value?: string }

/** A server of Sangha's own MCP library: once active (until the server restarts), it joins every session's catalog. */
export type LibraryMcp = { name: string; description: string; fields: LibraryField[]; active: boolean; missing: boolean }

/** A script a session runs in the background, and often waits on. */
export type BackgroundScript = {
  id: string
  /** As the SDK names it (e.g. "local_bash"). */
  kind: string
  /** What the SDK says about it: usually the raw command or its description. */
  command: string
  /** One short plain-English sentence on what it does, written by a small model (null until written). */
  summary: string | null
  /** When Sangha first saw it running, in ms. */
  since: number
}

export type PullRequest = {
  number: number
  url: string
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  /** The branch checked out in its folder, which may differ from the one Sangha created for it. */
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

/** A closed session: kept in the closed sessions history, and it can be reopened. */
export type ClosedSession = {
  id: string
  project: string
  agent: string
  title: string
  branch: string | null
  createdAt: number
  /** When it was closed. */
  archivedAt: number
  cost: number | null
  /** The whole session in one or two sentences (a small model writes it; null until written). */
  summary: string | null
  /** Your own note about it ("RIB ET MAIL"…), as it was when it closed: how you tell sessions apart. */
  note: string | null
  /** It started fresh in a new session: its work goes on there, nothing to reopen. */
  renewed: boolean
  /** The session still carrying its work on, through its fresh sessions (null when those closed too). */
  continuedIn: string | null
}

/** Board-wide stream: every session's state, plus the plan quota. */
export type GlobalEvent =
  | { kind: 'snapshot'; sessions: SessionSummary[]; quota: Quota | null; reserve: QuotaReserveState }
  | { kind: 'session'; session: SessionSummary }
  | { kind: 'removed'; id: string }
  | { kind: 'quota'; quota: Quota }
  /** The quota reserve changed (set by you, or reached / released as the quota moves). */
  | { kind: 'reserve'; reserve: QuotaReserveState }
  /** The closed sessions history changed (a session was closed, a summary was written, one was reopened): reload it. */
  | { kind: 'closed' }
  /** Projects were added or removed: reload them. */
  | { kind: 'projects' }
  /** The machine Sangha runs on, sampled every few seconds (see HostReport). */
  | { kind: 'host'; host: HostReport }
  /** The Advisor's count of `proposed` topics changed, or a run started or ended. */
  | { kind: 'advisor'; proposed: number; running: boolean }

/** ok: fine; warn: getting tight; red: saturated. */
export type HostLevel = 'ok' | 'warn' | 'red'

export type HostMetricKey = 'cpu' | 'memory' | 'swap' | 'disk'

export type HostMetric = {
  key: HostMetricKey
  label: string
  /** How full, 0..1. */
  value: number
  /** In words, e.g. "12.3 / 16 GB". */
  detail: string
  level: HostLevel
  /** Since when it stays red (epoch ms), null when it is not. */
  redSince: number | null
}

/** A running Docker container and what it takes. */
export type HostContainer = { id: string; name: string; image: string; cpu: number; memBytes: number; memPct: number }

/** A process among the heaviest of the machine. `cpu`: percent of one core. */
export type HostProcess = { pid: number; command: string; cpu: number; rssBytes: number }

/** A git worktree under workspaces/.worktrees, its weight on disk and the session working in it (if any). */
export type HostWorktree = {
  path: string
  project: string
  name: string
  bytes: number
  sessionId: string | null
  sessionTitle: string | null
  /** The session's own note (see `SessionSummary.note`), null when it has none or there is no live session. */
  sessionNote: string | null
  status: SessionStatus | null
  /**
   * What it is: a session's own worktree (`session`); one a session made for its subagents / parallel epics
   * (e.g. `kiat-team-lead-bc7d86-e181`, or Claude Code's `.claude/worktrees/agent-*`); or an orphan nobody claims. Values are wire values.
   */
  kind: 'session' | 'subagent' | 'orphan'
  /** For a subagent worktree: the session that made it (live or closed), with its note. */
  owner: { sessionId: string; note: string | null; title: string; alive: boolean; working: boolean } | null
  /** Safety facts, checked on disk: uncommitted changes, commits on no remote branch, a process running inside. */
  dirty: number
  unpushed: number
  inUse: boolean
  /** Safe to delete: clean, everything pushed, nobody inside, and its session (or owner) not working. */
  removable: boolean
  /** Why not, in plain English, when it isn't removable. */
  blocker: string | null
  /** The command to remove it yourself (always `git -C`, works from any folder). */
  removeCommand: string
  /** What this worktree is, in a sentence or two by a small model (branch, last commits, its session); null until written. */
  comment: string | null
}

/**
 * Something to do because a metric stayed red too long. `command`: to copy and run yourself (Sangha never
 * runs it). `sessionId`: the session concerned, e.g. to close it and free its worktree.
 */
/** An AI search through closed sessions: the matching sessions, best first, each with why it matches. */
export type ClosedSearchResult = { results: { id: string; reason: string }[] }

export type HostSuggestion = {
  id: string
  metric: HostMetricKey
  title: string
  detail: string
  command?: string
  sessionId?: string
}

/** One exchange of the little chat about a suggestion: your question, or the answer. */
export type HostChatTurn = { role: 'user' | 'assistant'; text: string }

/** One point of the recent history, each metric 0..1. */
export type HostSample = { at: number; cpu: number; memory: number; swap: number; disk: number }

export type HostReport = {
  at: number
  hostname: string
  platform: string
  cores: number
  /** Sangha runs inside a container (make up): figures are the container's VM, not your machine's. */
  inContainer: boolean
  /** The worst level among metrics. */
  level: HostLevel
  metrics: HostMetric[]
  /** About the last 30 minutes, oldest first. */
  history: HostSample[]
  processes: HostProcess[]
  /** null: Docker is not available. */
  containers: HostContainer[] | null
  /** Heaviest first; sized every few minutes. */
  worktrees: HostWorktree[]
  worktreesSizedAt: number | null
  /** How long a metric must stay red before a suggestion shows (ms). */
  redAfterMs: number
  suggestions: HostSuggestion[]
}

/** Visual identity of a subagent, served by the server so web and agent config stay in one place. */
export type SubagentProfile = {
  agentType: string
  name: string
  role: string
  color: string // CSS color
  model: string
}


/**
 * A reply to a message, WhatsApp-like. The quote travels inside the text, as a Markdown blockquote ahead
 * of your words: the session reads it as context whatever the road (queued, relayed to a terminal, resumed), and
 * the chat recognizes its first line to show it as a quote you can click back to.
 */
export type Quote = { author: string; text: string }

const QUOTE_MARK = '> ↩ Replying to '
// Older messages were stored with the French mark: still recognized when read back.
const LEGACY_QUOTE_MARK = '> ↩ En réponse à '
/** Longer quotes are cut: enough context, without resending a whole report. */
export const QUOTE_MAX = 1500

export const withQuote = (q: Quote, body: string) => {
  const text = q.text.length > QUOTE_MAX ? `${q.text.slice(0, QUOTE_MAX)}…` : q.text
  return `${QUOTE_MARK}${q.author}:\n${text.split('\n').map((l) => `> ${l}`).join('\n')}\n\n${body}`
}

export const splitQuote = (text: string): { quote: Quote | null; body: string } => {
  const mark = [QUOTE_MARK, LEGACY_QUOTE_MARK].find((m) => text.startsWith(m))
  if (!mark) return { quote: null, body: text }
  const lines = text.split('\n')
  const author = lines[0]!.slice(mark.length).replace(/ ?:$/, '')
  let i = 1
  while (i < lines.length && lines[i]!.startsWith('>')) i++
  const quoted = lines.slice(1, i).map((l) => l.replace(/^> ?/, ''))
  return { quote: { author, text: quoted.join('\n') }, body: lines.slice(i).join('\n').replace(/^\n+/, '') }
}

/** The name and email every session commits with, set once for all of Sangha. */
export type GitIdentity = { name: string; email: string }

/**
 * A session's own environment variables, written like a .env file: one KEY=value per line, `export`
 * and quotes accepted, blank lines and # comments skipped. Errors name the line they come from.
 */
export function parseEnvText(text: string): { env: Record<string, string>; errors: string[] } {
  const env: Record<string, string> = {}
  const errors: string[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) return void errors.push(`line ${i + 1}: "${line.slice(0, 40)}" is not of the form KEY=value`)
    let value = m[2]!
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1)
    env[m[1]!] = value
  })
  return { env, errors }
}

export const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`)
    .join('\n')

/** Feedback left on a specific message (eventSeq) or on the whole conversation (eventSeq: null). */
export type Feedback = {
  id: string
  sessionId: string
  eventSeq: number | null
  rating: 'up' | 'down' | null
  comment: string | null
  /** The message commented on and its neighbours, frozen when the feedback was given, truncated. */
  excerpt: string
  createdAt: number
  /** Null until the Advisor has read it. */
  processedAt: number | null
}

export type AdvisorTopicStatus = 'proposed' | 'accepted' | 'rejected' | 'done'

/** An improvement suggestion. `scope`: 'manual' | 'sangha' | 'project:<name>'. */
export type AdvisorTopic = {
  id: string
  scope: string
  title: string
  detail: string
  /** Ids of the feedback and sessions that support it. */
  evidence: string[]
  status: AdvisorTopicStatus
  createdAt: number
  updatedAt: number
}

export type AdvisorReportKind = 'daily' | 'weekly' | 'conversation' | 'manual' | 'skipped'

export type AdvisorReport = {
  id: string
  kind: AdvisorReportKind
  text: string
  /** Topics created or updated by this report. */
  topicIds: string[]
  costUsd: number | null
  tokens: number | null
  createdAt: number
}

export type AdvisorChatTurn = { id: number; role: 'user' | 'advisor'; text: string; createdAt: number }

export type AdvisorSettings = {
  enabled: boolean
  /** A ModelChoice id: 'sonnet' by default, or '<provider>::<model>'. */
  model: string
  levels: { manual: boolean; sangha: boolean; project: boolean }
  projects: string[]
  /** 'HH:MM', provider engine. */
  dailyAt: string
  /** day: 0-6 (JS convention, 4 = Thursday), at: 'HH:MM', maxWeekUsedPct: 0-100. Claude engine. */
  weekly: { day: number; at: string; maxWeekUsedPct: number }
  /** Cap on the context sent to the model. */
  maxInputChars: number
  /** The "since the last run" bound; also what marks a weekly window as resolved. */
  lastRunAt: number | null
}

/** A partial settings change: nested objects can be partial too. */
export type AdvisorSettingsPatch = Partial<Omit<AdvisorSettings, 'levels' | 'weekly'>> & {
  levels?: Partial<AdvisorSettings['levels']>
  weekly?: Partial<AdvisorSettings['weekly']>
}

export type AdvisorState = {
  settings: AdvisorSettings
  /** Best effort: the real decision is still `due()`'s. */
  nextRunAt: number | null
  running: boolean
  lastError: string | null
  topics: AdvisorTopic[]
  /** The latest 10. */
  reports: AdvisorReport[]
  /** The latest 20 messages. */
  chat: AdvisorChatTurn[]
}
