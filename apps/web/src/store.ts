import { create } from 'zustand'
import type { Envelope, MonkProfile, MonkStatus, ProjectInfo, Quota, SessionSummary, Usage } from '@sangha/shared'

export type LogItem = { at: number } & ({ kind: 'tool'; tool: string; summary: string } | { kind: 'text'; text: string })

export type MonkInstance = {
  monkId: string
  agentType: string
  description: string
  prompt: string
  depth: number
  status: MonkStatus
  lastTool: { tool: string; summary: string } | null
  log: LogItem[]
  summary: string
  tokens: number
  toolUses: number
  startedAt: number
  endedAt: number | null
}

export type ChatItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'buddha'; text: string; at: number }
  | { kind: 'tool'; tool: string; summary: string; at: number }
  | { kind: 'summon'; monkId: string; at: number }
  | { kind: 'done'; monkId: string; at: number }
  | { kind: 'turn'; ok: boolean; costUsdEquiv: number; durationMs: number; at: number }
  | { kind: 'error'; text: string; at: number }

export type SessionView = {
  lastSeq: number
  chat: ChatItem[]
  draft: string
  monks: Record<string, MonkInstance>
  monkOrder: string[]
  busy: boolean
  quota: Quota | null
  model: string | null
  skills: string[]
  plugins: string[]
  costUsdEquiv: number
  usage: Usage
}

export const emptyView = (): SessionView => ({
  lastSeq: 0,
  chat: [],
  draft: '',
  monks: {},
  monkOrder: [],
  busy: false,
  quota: null,
  model: null,
  skills: [],
  plugins: [],
  costUsdEquiv: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

/** Pure reducer: MonasteryEvent envelope -> view. */
export function reduce(v: SessionView, { seq, at, ev }: Envelope): SessionView {
  if (seq <= v.lastSeq) return v
  const s: SessionView = { ...v, lastSeq: seq }
  const patchMonk = (id: string, f: (m: MonkInstance) => Partial<MonkInstance>) => {
    const m = s.monks[id]
    if (m) s.monks = { ...s.monks, [id]: { ...m, ...f(m) } }
  }
  switch (ev.t) {
    case 'session.started':
      return { ...s, model: ev.model, skills: ev.skills ?? [], plugins: ev.plugins ?? [] }
    case 'user.message':
      return { ...s, chat: [...s.chat, { kind: 'user', text: ev.text, at }] }
    case 'buddha.delta':
      return { ...s, draft: s.draft + ev.text }
    case 'buddha.text':
      return { ...s, draft: '', chat: [...s.chat, { kind: 'buddha', text: ev.text, at }] }
    case 'buddha.tool':
      return { ...s, chat: [...s.chat, { kind: 'tool', tool: ev.tool, summary: ev.summary, at }] }
    case 'monk.summoned':
      s.monks = {
        ...s.monks,
        [ev.monkId]: {
          monkId: ev.monkId,
          agentType: ev.agentType,
          description: ev.description,
          prompt: ev.prompt,
          depth: ev.depth,
          status: 'working',
          lastTool: null,
          log: [],
          summary: '',
          tokens: 0,
          toolUses: 0,
          startedAt: at,
          endedAt: null,
        },
      }
      return { ...s, monkOrder: [...s.monkOrder, ev.monkId], chat: [...s.chat, { kind: 'summon', monkId: ev.monkId, at }] }
    case 'monk.tool':
      patchMonk(ev.monkId, (m) => ({ lastTool: { tool: ev.tool, summary: ev.summary }, log: [...m.log, { kind: 'tool', tool: ev.tool, summary: ev.summary, at }] }))
      return s
    case 'monk.text':
      patchMonk(ev.monkId, (m) => ({ log: [...m.log, { kind: 'text', text: ev.text, at }] }))
      return s
    case 'monk.progress':
      patchMonk(ev.monkId, () => ({ tokens: ev.tokens, toolUses: ev.toolUses }))
      return s
    case 'monk.done':
      patchMonk(ev.monkId, () => ({ status: ev.status, summary: ev.summary, endedAt: at }))
      return { ...s, chat: [...s.chat, { kind: 'done', monkId: ev.monkId, at }] }
    case 'turn.done':
      return {
        ...s,
        draft: '',
        costUsdEquiv: s.costUsdEquiv + ev.costUsdEquiv,
        usage: {
          inputTokens: s.usage.inputTokens + ev.usage.inputTokens,
          outputTokens: s.usage.outputTokens + ev.usage.outputTokens,
          cacheReadTokens: s.usage.cacheReadTokens + ev.usage.cacheReadTokens,
          cacheWriteTokens: s.usage.cacheWriteTokens + ev.usage.cacheWriteTokens,
        },
        chat: [...s.chat, { kind: 'turn', ok: ev.ok, costUsdEquiv: ev.costUsdEquiv, durationMs: ev.durationMs, at }],
      }
    case 'quota':
      return { ...s, quota: ev.quota }
    case 'busy':
      return { ...s, busy: ev.busy }
    case 'recap':
    case 'background':
      return s
    case 'error':
      return { ...s, chat: [...s.chat, { kind: 'error', text: ev.message, at }] }
  }
}

export type Dialog = { kind: 'new-session'; project?: string } | { kind: 'add-project' } | { kind: 'dismiss'; id: string; working?: boolean }
  | { kind: 'remove-project'; name: string }
  | { kind: 'incense'; id: string }
  | { kind: 'nirvana' }
  | { kind: 'costs' } | null

type AppState = {
  profiles: MonkProfile[]
  projects: ProjectInfo[]
  /** Every priest (and Buddha), kept live by the monastery-wide stream. */
  sessions: Record<string, SessionSummary>
  quota: Quota | null
  /** Bumped on every `{kind:'nirvana'}` global event: its open dialog refetches (arrivals, summaries, reincarnations). */
  nirvanaTick: number
  /** Bumped only when a non-external priest actually leaves the courtyard (flies into the moon): what the moon's glow watches. */
  moonArrivals: number
  /** Bumped on every `{kind:'session'}` global event: what the cost chip watches, throttled, to refresh its total. */
  sessionsVersion: number
  /** Session shown in the panel: a priest id, 'buddha', or null. */
  selectedId: string | null
  view: SessionView
  selectedMonk: string | null
  dialog: Dialog
  /** Sessions the user just interrupted: their next status change must not ring the bell or notify. */
  interruptedIds: Set<string>
  markInterrupted: (id: string) => void
  clearInterrupted: (id: string) => void
  apply: (env: Envelope) => void
  /** Apply a batch of events with a single re-render (a session's history arrives in bulk). */
  applyMany: (envs: Envelope[]) => void
  set: (p: Partial<AppState>) => void
}

export const useApp = create<AppState>((set) => ({
  profiles: [],
  projects: [],
  sessions: {},
  quota: null,
  nirvanaTick: 0,
  moonArrivals: 0,
  sessionsVersion: 0,
  selectedId: null,
  view: emptyView(),
  selectedMonk: null,
  dialog: null,
  interruptedIds: new Set(),
  markInterrupted: (id) => set((st) => ({ interruptedIds: new Set(st.interruptedIds).add(id) })),
  clearInterrupted: (id) =>
    set((st) => {
      if (!st.interruptedIds.has(id)) return {}
      const next = new Set(st.interruptedIds)
      next.delete(id)
      return { interruptedIds: next }
    }),
  apply: (env) =>
    set((st) => {
      const view = reduce(st.view, env)
      return env.ev.t === 'quota' ? { view, quota: env.ev.quota } : { view }
    }),
  applyMany: (envs) =>
    set((st) => {
      let view = st.view
      let quota = st.quota
      for (const env of envs) {
        view = reduce(view, env)
        if (env.ev.t === 'quota') quota = env.ev.quota
      }
      return { view, quota }
    }),
  set: (p) => set(p),
}))
