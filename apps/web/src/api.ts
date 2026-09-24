import type { Envelope, GlobalEvent, MonkProfile, ProjectInfo, ProjectSuggestion, SessionSummary } from '@sangha/shared'
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
  monks: () => json<MonkProfile[]>('/api/monks'),
  projects: () => json<ProjectInfo[]>('/api/projects'),
  addProject: (source: { gitUrl: string } | { path: string }, name?: string) => json<{ name: string }>('/api/projects', post({ ...source, name })),
  suggestions: () => json<ProjectSuggestion[]>('/api/projects/suggestions'),
  branches: (project: string) => json<string[]>(`/api/projects/${encodeURIComponent(project)}/branches`),
  createSession: (b: { project: string; agent: string; prompt: string; baseRef?: string }) => json<SessionSummary>('/api/sessions', post(b)),
  /** Your reply: straight to a Sangha priest, relayed to a terminal session, or resuming an ended one. */
  send: (id: string, text: string) =>
    json<{ via: 'sangha' } | { via: 'peer'; to: string } | { via: 'adopted'; id: string }>(`/api/sessions/${id}/messages`, post({ text })),
  interrupt: (id: string) => json<void>(`/api/sessions/${id}/interrupt`, post()),
  resume: (id: string) => json<void>(`/api/sessions/${id}/resume`, post()),
  /** Ask the session now whether to continue in a fresh one. */
  renew: (id: string) => json<void>(`/api/sessions/${id}/renew`, post()),
  /** Hand his move to a fresh session to Buddha (or take it back). */
  shepherd: (id: string, on: boolean) => json<unknown>(`/api/sessions/${id}/shepherd`, post({ on })),
  silence: (id: string, silent: boolean) => json<void>(`/api/sessions/${id}/silence`, post({ silent })),
  seen: (id: string) => json<void>(`/api/sessions/${id}/seen`, post()),
  removeProject: (name: string, force = false) => json<void>(`/api/projects/${encodeURIComponent(name)}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  archive: (id: string, force = false) => json<void>(`/api/sessions/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
}

/** Follow the whole monastery: every session's status, novices and the plan quota. */
export function openMonastery(onError: () => void) {
  const es = new EventSource('/api/events')
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data) as GlobalEvent
    const { set, sessions } = useApp.getState()
    switch (ev.kind) {
      case 'snapshot':
        set({ sessions: Object.fromEntries(ev.sessions.map((s) => [s.id, s])), ...(ev.quota ? { quota: ev.quota } : {}) })
        break
      case 'session':
        set({ sessions: { ...sessions, [ev.session.id]: ev.session } })
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

export function closeSession() {
  stop()
  useApp.getState().set({ selectedId: null, view: emptyView(), selectedMonk: null })
  setUrl('')
}
