import type { CostReport, Envelope, GitIdentity, ModelChoice, Provider, GlobalEvent, McpServer, MonkProfile, NirvanaEntry, ProjectInfo, ProjectSuggestion, SessionSummary } from '@sangha/shared'
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
  /** Who priests commit as (null: not set yet, and git stays closed to them). */
  gitIdentity: () => json<GitIdentity | null>('/api/git-identity'),
  saveGitIdentity: (v: GitIdentity) => json<GitIdentity>('/api/git-identity', { method: 'PUT', body: JSON.stringify(v) }),
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
  /** Your reply: straight to a Sangha priest, relayed to a terminal session, or resuming an ended one. */
  send: (id: string, text: string) =>
    json<{ via: 'sangha' } | { via: 'peer'; to: string } | { via: 'adopted'; id: string }>(`/api/sessions/${id}/messages`, post({ text })),
  interrupt: (id: string) => json<void>(`/api/sessions/${id}/interrupt`, post()),
  resume: (id: string) => json<void>(`/api/sessions/${id}/resume`, post()),
  /** Ask the session now whether to continue in a fresh one. */
  renew: (id: string) => json<void>(`/api/sessions/${id}/renew`, post()),
  /** Hand his move to a fresh session to Buddha (or take it back). */
  shepherd: (id: string, on: boolean, context?: string) => json<unknown>(`/api/sessions/${id}/shepherd`, post({ on, context })),
  silence: (id: string, silent: boolean) => json<void>(`/api/sessions/${id}/silence`, post({ silent })),
  /** Your own note about him, shown under him in the courtyard (null clears it). */
  note: (id: string, note: string | null) => json<void>(`/api/sessions/${id}/note`, post({ note })),
  /** Your messages still waiting for his turn to end: change one, take it back, or send it right away. */
  editQueued: (id: string, mid: string, text: string) => json<void>(`/api/sessions/${id}/queued/${mid}`, post({ text })),
  withdrawQueued: (id: string, mid: string) => json<void>(`/api/sessions/${id}/queued/${mid}/withdraw`, post()),
  sendQueuedNow: (id: string, mid: string) => json<void>(`/api/sessions/${id}/queued/${mid}/now`, post()),
  /** Changes the model he thinks with ('' : his agent's own); switching Claude ↔ OVH relaunches him. */
  setModel: (id: string, model: string) => json<void>(`/api/sessions/${id}/model`, post({ model })),
  /** A standing instruction recalled to him with each of your messages (null clears it). */
  reminder: (id: string, text: string | null) => json<void>(`/api/sessions/${id}/reminder`, post({ text })),
  seen: (id: string) => json<void>(`/api/sessions/${id}/seen`, post()),
  removeProject: (name: string, force = false) => json<void>(`/api/projects/${encodeURIComponent(name)}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  archive: (id: string, force = false) => json<void>(`/api/sessions/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  /** The moon's history: every priest sent to nirvana, newest first. */
  nirvana: () => json<NirvanaEntry[]>('/api/nirvana'),
  /** Bring him back to the courtyard, in a fresh session. */
  /** Relaunch his Claude process on the same conversation, so it rereads his agent file, tools and MCP. */
  restart: (id: string) => json<void>(`/api/sessions/${id}/restart`, post()),
  reincarnate: (id: string) => json<SessionSummary>(`/api/sessions/${id}/reincarnate`, post()),
  /** What every session would have cost at API prices, since monitoring began, broken down by month. */
  costs: () => json<CostReport>('/api/costs'),
  /** His MCP servers: may take a few seconds, it wakes his process to ask. */
  mcpServers: (id: string) => json<McpServer[]>(`/api/sessions/${id}/mcp`),
  /** Switch one of his MCP servers on or off; enabling can take up to ~30s while it connects. */
  /** Sign in to one of his servers: opens your browser, answers once you authorized (up to a few minutes). */
  loginMcpServer: (id: string, name: string) => json<McpServer[]>(`/api/sessions/${id}/mcp/login`, post({ name })),
  setMcpServer: (id: string, name: string, enabled: boolean) => json<McpServer[]>(`/api/sessions/${id}/mcp`, post({ name, enabled })),
}

/** Follow the whole monastery: every session's status, novices and the plan quota. */
export function openMonastery(onError: () => void) {
  const es = new EventSource('/api/events')
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data) as GlobalEvent
    const { set, sessions, nirvanaTick, moonArrivals, sessionsVersion } = useApp.getState()
    switch (ev.kind) {
      case 'snapshot':
        set({ sessions: Object.fromEntries(ev.sessions.map((s) => [s.id, s])), ...(ev.quota ? { quota: ev.quota } : {}) })
        break
      case 'session':
        // Also what the cost chip watches (throttled) to keep its total roughly current.
        set({ sessions: { ...sessions, [ev.session.id]: ev.session }, sessionsVersion: sessionsVersion + 1 })
        break
      case 'removed': {
        const { [ev.id]: gone, ...rest } = sessions
        // The moon only glows when a priest actually flew into it: a non-external session leaving
        // the courtyard (an external one just returns to its own terminal, nothing to see here).
        set({ sessions: rest, ...(gone && !gone.external ? { moonArrivals: moonArrivals + 1 } : {}) })
        if (useApp.getState().selectedId === ev.id) closeSession()
        break
      }
      case 'quota':
        set({ quota: ev.quota })
        break
      case 'nirvana':
        // The moon's history changed (arrival, summary written, reincarnation): bump a counter the
        // dialog watches to refetch, and that also triggers the moon's glow.
        set({ nirvanaTick: nirvanaTick + 1 })
        break
      case 'projects':
        void api.projects().then((projects) => set({ projects }))
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
  // Opening (even the priest whose panel is mid-close) cancels any closing animation in flight.
  set({ selectedId: id, view: emptyView(), selectedMonk: null, closing: null })
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

/**
 * Starts the panel's closing animation (the ✕ button, Escape, and a click on the backdrop all call
 * this). `selectedId` is left as-is so the panel keeps rendering while it shrinks toward him;
 * SessionView calls `finishClose` once that animation lands.
 */
export function closeSession() {
  const { selectedId, closing, set } = useApp.getState()
  if (!selectedId || closing) return // nothing open, or already closing
  stop()
  setUrl('')
  const el = document.querySelector<Element>(`[data-session-id="${CSS.escape(selectedId)}"]`)
  const rect = el?.getBoundingClientRect()
  const onScreen = rect && rect.width > 4 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
  const target = onScreen ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  set({ closing: { id: selectedId, target } })
  // Should the animation never report its end (a hidden tab pauses it), close anyway.
  setTimeout(() => finishClose(selectedId), 1_000)
}

let ackToken = 0

/** The closing animation has landed on him: the real cleanup, then his brief acknowledgement glow. */
export function finishClose(id: string) {
  const { closing, set } = useApp.getState()
  if (closing?.id !== id) return // superseded (a new close, or the close was cancelled by reopening)
  const token = ++ackToken
  set({ selectedId: null, view: emptyView(), selectedMonk: null, closing: null, closingAck: { id, token } })
  setTimeout(() => {
    if (useApp.getState().closingAck?.token === token) useApp.getState().set({ closingAck: null })
  }, 1000)
}
