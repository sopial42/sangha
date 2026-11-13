import type { CostReport, ElderSettings, ElderSettingsPatch, ElderState, ElderTopic, Envelope, Feedback, GitIdentity, HostChatTurn, HostReport, HostSuggestion, ModelChoice, Provider, GlobalEvent, GlobalMcp, LibraryMcp, McpServer, MonkProfile, NirvanaEntry, NirvanaSearchResult, ProjectInfo, ProjectSuggestion, QuotaReserve, QuotaReserveState, SessionSummary } from '@sangha/shared'
import { emptyView, useApp } from './store'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
  }
}

/** Why setting a session aside (or putting it back on the board) didn't save, in a word for you. */
export const lotusFailure = (e: unknown) =>
  e instanceof ApiError && e.status === 404
    ? 'Your Sangha server does not support setting sessions aside yet: restart it (make dev).'
    : `Could not set the session aside: ${e instanceof Error ? e.message : String(e)}.`

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError((body as { error?: string } | null)?.error ?? `${res.status}`, res.status, body)
  }
  const type = res.headers.get('content-type') ?? ''
  return res.status === 204 || !type.includes('json') ? (undefined as T) : res.json()
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  /** Who sessions commit as (null: not set yet, and git stays closed to them). */
  gitIdentity: () => json<GitIdentity | null>('/api/git-identity'),
  saveGitIdentity: (v: GitIdentity) => json<GitIdentity>('/api/git-identity', { method: 'PUT', body: JSON.stringify(v) }),
  /** The share of the plan quota kept untouched, and whether it currently bites. */
  quotaReserve: () => json<QuotaReserveState>('/api/quota-reserve'),
  saveQuotaReserve: (v: Partial<QuotaReserve>) => json<QuotaReserveState>('/api/quota-reserve', { method: 'PUT', body: JSON.stringify(v) }),
  monks: () => json<MonkProfile[]>('/api/monks'),
  models: () => json<ModelChoice[]>('/api/models'),
  /** Endpoints other than Claude (address and credentials set once) and the models they offer. */
  providers: () => json<Provider[]>('/api/providers'),
  saveProvider: (p: Partial<Provider>) => json<Provider>('/api/providers', post(p)),
  removeProvider: (id: string) => json<void>(`/api/providers/${id}/remove`, post()),
  probeModels: (p: Pick<Provider, 'baseUrl' | 'apiKey' | 'authToken'>) => json<string[]>('/api/providers/probe', post(p)),
  projects: () => json<ProjectInfo[]>('/api/projects'),
  addProject: (source: { gitUrl: string } | { path: string }, name?: string) => json<{ name: string }>('/api/projects', post({ ...source, name })),
  suggestions: () => json<ProjectSuggestion[]>('/api/projects/suggestions'),
  branches: (project: string) => json<string[]>(`/api/projects/${encodeURIComponent(project)}/branches`),
  createSession: (b: { project: string; agent: string; prompt: string; baseRef?: string; model?: string }) => json<SessionSummary>('/api/sessions', post(b)),
  /** Your reply: straight to a Sangha session, relayed to a terminal session, or resuming an ended one. */
  send: (id: string, text: string) =>
    json<{ via: 'sangha' } | { via: 'peer'; to: string } | { via: 'adopted'; id: string }>(`/api/sessions/${id}/messages`, post({ text })),
  interrupt: (id: string) => json<void>(`/api/sessions/${id}/interrupt`, post()),
  resume: (id: string) => json<void>(`/api/sessions/${id}/resume`, post()),
  /** Ask the session now whether to continue in a fresh one. */
  renew: (id: string) => json<void>(`/api/sessions/${id}/renew`, post()),
  /** Let the orchestrator hand this session off to a fresh one (or take it back). */
  shepherd: (id: string, on: boolean, context?: string) => json<unknown>(`/api/sessions/${id}/shepherd`, post({ on, context })),
  /**
   * His autonomy: starts a `/goal` or a `/loop` (the server stops the other one first); `null` stops
   * whichever runs, immediately.
   */
  autonomy: (id: string, body: { mode: 'goal' | 'loop'; text: string; interval?: string | null } | null) =>
    json<void>(`/api/sessions/${id}/autonomy`, post(body)),
  silence: (id: string, silent: boolean) => json<void>(`/api/sessions/${id}/silence`, post({ silent })),
  /** Set a session aside (off the board), or put it back. */
  lotus: (id: string, lotus: boolean) => json<void>(`/api/sessions/${id}/lotus`, post({ lotus })),
  /** Your own name for a session (null clears it). */
  note: (id: string, note: string | null) => json<void>(`/api/sessions/${id}/note`, post({ note })),
  /** Your messages still waiting for its turn to end: change one, take it back, or send it right away. */
  editQueued: (id: string, mid: string, text: string) => json<void>(`/api/sessions/${id}/queued/${mid}`, post({ text })),
  withdrawQueued: (id: string, mid: string) => json<void>(`/api/sessions/${id}/queued/${mid}/withdraw`, post()),
  sendQueuedNow: (id: string, mid: string) => json<void>(`/api/sessions/${id}/queued/${mid}/now`, post()),
  /** Changes the session's model ('' : its agent's own); switching Claude and a provider relaunches it. */
  setModel: (id: string, model: string) => json<void>(`/api/sessions/${id}/model`, post({ model })),
  /** A standing instruction sent with each of your messages (null clears it). */
  reminder: (id: string, text: string | null) => json<void>(`/api/sessions/${id}/reminder`, post({ text })),
  seen: (id: string) => json<void>(`/api/sessions/${id}/seen`, post()),
  removeProject: (name: string, force = false) => json<void>(`/api/projects/${encodeURIComponent(name)}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  archive: (id: string, force = false) => json<void>(`/api/sessions/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  /** Closed sessions, newest first. */
  nirvana: () => json<NirvanaEntry[]>('/api/nirvana'),
  /** Ask a model to find, among closed sessions, the ones matching a question: best first, each with why it matches. */
  nirvanaSearch: (q: string) => json<NirvanaSearchResult>('/api/nirvana/search', post({ q })),
  /** Reopen a closed session, in a fresh session. */
  /** Relaunch the Claude process on the same conversation, so it rereads its agent file, tools and MCP. */
  restart: (id: string) => json<void>(`/api/sessions/${id}/restart`, post()),
  /** Starts right away with the link, or (mid-turn) marks it for the moment the turn ends (nothing is cut). */
  remoteControl: (id: string) => json<{ url: string } | { pending: true }>(`/api/sessions/${id}/remote-control`, post()),
  stopRemote: (id: string) => json<void>(`/api/sessions/${id}/remote-control/stop`, post()),
  setEnv: (id: string, env: Record<string, string>, restart: boolean) => json<void>(`/api/sessions/${id}/env`, { method: 'PUT', body: JSON.stringify({ env, restart }) }),
  reincarnate: (id: string) => json<SessionSummary>(`/api/sessions/${id}/reincarnate`, post()),
  /** What every session would have cost at API prices, since monitoring began, broken down by month. */
  costs: () => json<CostReport>('/api/costs'),
  /** Your latest screenshot, copied where a session can read it: its path to put in the message. */
  latestScreenshot: () => json<{ path: string; at: number }>('/api/screenshot/latest', post()),
  /** The machine Sangha runs on, right now. 503 before the first sample (json<T> then throws). */
  host: () => json<HostReport>('/api/host'),
  /** Ask a model about a suggestion, the exchange so far included (the last turn is your question). */
  askHost: (suggestion: HostSuggestion, chat: HostChatTurn[]) => json<{ answer: string }>('/api/host/ask', post({ suggestion, chat })),
  /** The session's MCP servers: may take a few seconds, it wakes the process to ask. */
  mcpServers: (id: string) => json<McpServer[]>(`/api/sessions/${id}/mcp`),
  /** Switch one of its MCP servers on or off; enabling can take up to ~30s while it connects. */
  /** Sign in to one of its servers: opens your browser, answers once you authorized (up to a few minutes). */
  loginMcpServer: (id: string, name: string) => json<McpServer[]>(`/api/sessions/${id}/mcp/login`, post({ name })),
  /** For this session only (`enabled` null: back to the switch of all of Sangha). */
  setMcpServer: (id: string, name: string, enabled: boolean | null) => json<McpServer[]>(`/api/sessions/${id}/mcp`, post({ name, enabled })),
  globalMcp: () => json<GlobalMcp[]>('/api/mcp'),
  setGlobalMcp: (name: string, enabled: boolean) => json<GlobalMcp[]>('/api/mcp', post({ name, enabled })),
  mcpLibrary: () => json<LibraryMcp[]>('/api/mcp-library'),
  /** `values`: credentials to save in .env (an empty one keeps what is saved); `active`: switch it on or off. */
  setLibraryMcp: (name: string, change: { active?: boolean; values?: Record<string, string> }) => json<LibraryMcp[]>(`/api/mcp-library/${encodeURIComponent(name)}`, post(change)),
  /** The Advisor: its settings, state (next pass, running, last error), topics, last reports and chat. */
  elder: () => json<ElderState>('/api/elder'),
  saveElderSettings: (patch: ElderSettingsPatch) => json<ElderSettings>('/api/elder/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  /** "Run now": fires an Advisor pass right away; the dialog follows along via the `elder` global event. */
  runElderNow: () => json<void>('/api/elder/run', post()),
  askElder: (text: string) => json<{ reply: string }>('/api/elder/ask', post({ text })),
  voteElderTopic: (id: string, vote: 'up' | 'down') => json<ElderTopic>(`/api/elder/topics/${id}/vote`, post({ vote })),
  doneElderTopic: (id: string) => json<ElderTopic>(`/api/elder/topics/${id}/done`, post()),
  /** A comment or a thumbs up/down on a message (`eventSeq`) or on the whole conversation (omitted): the Advisor reads it later. */
  sendFeedback: (b: { sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }) => json<Feedback>('/api/feedback', post(b)),
  sessionFeedback: (id: string) => json<Feedback[]>(`/api/sessions/${id}/feedback`),
}

/** Follow everything: every session's status, subagents and the plan quota. */
export function openEvents(onError: () => void) {
  const es = new EventSource('/api/events')
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data) as GlobalEvent
    const { set, sessions, nirvanaTick, sessionsVersion } = useApp.getState()
    switch (ev.kind) {
      case 'snapshot':
        set({ sessions: Object.fromEntries(ev.sessions.map((s) => [s.id, s])), ...(ev.quota ? { quota: ev.quota } : {}), reserve: ev.reserve })
        break
      case 'session':
        // Also what the cost chip watches (throttled) to keep its total roughly current.
        set({ sessions: { ...sessions, [ev.session.id]: ev.session }, sessionsVersion: sessionsVersion + 1 })
        break
      case 'removed': {
        const { [ev.id]: _gone, ...rest } = sessions
        set({ sessions: rest })
        if (useApp.getState().selectedId === ev.id) closeSession()
        break
      }
      case 'quota':
        set({ quota: ev.quota })
        break
      case 'reserve':
        set({ reserve: ev.reserve })
        break
      case 'nirvana':
        // Closed sessions changed (arrival, summary written, reopened): the dialog watches this counter to refetch.
        set({ nirvanaTick: nirvanaTick + 1 })
        break
      case 'projects':
        void api.projects().then((projects) => set({ projects }))
        break
      case 'host':
        set({ host: ev.host })
        break
      case 'elder':
        set({ elderBadge: { proposed: ev.proposed, running: ev.running } })
        break
    }
  }
  es.onerror = onError
  return () => es.close()
}

let source: EventSource | null = null

function stop() {
  source?.close()
  source = null
}

const setUrl = (query: string) => history.replaceState(null, '', query ? `?${query}` : location.pathname)

/** Open a session in the panel: backlog then live events. EventSource reconnects with Last-Event-ID. */
export function openSession(id: string) {
  stop()
  const { set, applyMany } = useApp.getState()
  set({ selectedId: id, view: emptyView(), selectedMonk: null })
  setUrl(`session=${encodeURIComponent(id)}`)
  const es = new EventSource(`/api/sessions/${id}/events`)
  source = es
  // Events are buffered and applied once per frame: a long history renders once, not thousands of times.
  let pending: Envelope[] = []
  let frame = 0
  es.onmessage = (e) => {
    pending.push(JSON.parse(e.data) as Envelope)
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        const batch = pending
        pending = []
        if (source === es) applyMany(batch)
      })
  }
}

/** Back to the board: stops following the session and clears it. */
export function closeSession() {
  const { selectedId, set } = useApp.getState()
  if (!selectedId) return
  stop()
  setUrl('')
  set({ selectedId: null, view: emptyView(), selectedMonk: null })
}
