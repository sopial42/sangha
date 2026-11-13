import { create } from 'zustand'
import type { Envelope, HostReport, ModelChoice, SubagentProfile, SubagentStatus, ProjectInfo, Quota, QuotaReserveState, SessionSummary, Usage, GitIdentity } from '@sangha/shared'

export type LogItem = { at: number } & ({ kind: 'tool'; tool: string; summary: string } | { kind: 'text'; text: string })

export type SubagentRun = {
  subagentId: string
  agentType: string
  description: string
  prompt: string
  depth: number
  status: SubagentStatus
  lastTool: { tool: string; summary: string } | null
  log: LogItem[]
  summary: string
  tokens: number
  toolUses: number
  startedAt: number
  endedAt: number | null
}

export type ChatItem =
  | { kind: 'user'; text: string; at: number; seq: number }
  | { kind: 'assistant'; text: string; at: number; seq: number }
  | { kind: 'tool'; tool: string; summary: string; at: number }
  | { kind: 'summon'; subagentId: string; at: number }
  | { kind: 'done'; subagentId: string; at: number }
  | { kind: 'turn'; ok: boolean; costUsdEquiv: number; durationMs: number; at: number }
  | { kind: 'error'; text: string; at: number }

export type SessionView = {
  lastSeq: number
  chat: ChatItem[]
  draft: string
  subagents: Record<string, SubagentRun>
  subagentOrder: string[]
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
  subagents: {},
  subagentOrder: [],
  busy: false,
  quota: null,
  model: null,
  skills: [],
  plugins: [],
  costUsdEquiv: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

/** Pure reducer: event envelope -> view. */
export function reduce(v: SessionView, { seq, at, ev }: Envelope): SessionView {
  if (seq <= v.lastSeq) return v
  const s: SessionView = { ...v, lastSeq: seq }
  const patchSubagent = (id: string, f: (m: SubagentRun) => Partial<SubagentRun>) => {
    const m = s.subagents[id]
    if (m) s.subagents = { ...s.subagents, [id]: { ...m, ...f(m) } }
  }
  switch (ev.t) {
    case 'session.started':
      return { ...s, model: ev.model, skills: ev.skills ?? [], plugins: ev.plugins ?? [] }
    case 'user.message':
      return { ...s, chat: [...s.chat, { kind: 'user', text: ev.text, at, seq }] }
    case 'assistant.delta':
      return { ...s, draft: s.draft + ev.text }
    case 'assistant.text':
      return { ...s, draft: '', chat: [...s.chat, { kind: 'assistant', text: ev.text, at, seq }] }
    case 'assistant.tool':
      return { ...s, chat: [...s.chat, { kind: 'tool', tool: ev.tool, summary: ev.summary, at }] }
    case 'subagent.started':
      s.subagents = {
        ...s.subagents,
        [ev.subagentId]: {
          subagentId: ev.subagentId,
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
      // The same subagent can be announced twice (a replayed transcript): one entry, or the list repeats keys.
      return {
        ...s,
        subagentOrder: s.subagentOrder.includes(ev.subagentId) ? s.subagentOrder : [...s.subagentOrder, ev.subagentId],
        chat: [...s.chat, { kind: 'summon', subagentId: ev.subagentId, at }],
      }
    case 'subagent.tool':
      patchSubagent(ev.subagentId, (m) => ({ lastTool: { tool: ev.tool, summary: ev.summary }, log: [...m.log, { kind: 'tool', tool: ev.tool, summary: ev.summary, at }] }))
      return s
    case 'subagent.text':
      patchSubagent(ev.subagentId, (m) => ({ log: [...m.log, { kind: 'text', text: ev.text, at }] }))
      return s
    case 'subagent.progress':
      patchSubagent(ev.subagentId, () => ({ tokens: ev.tokens, toolUses: ev.toolUses }))
      return s
    case 'subagent.done':
      patchSubagent(ev.subagentId, () => ({ status: ev.status, summary: ev.summary, endedAt: at }))
      return { ...s, chat: [...s.chat, { kind: 'done', subagentId: ev.subagentId, at }] }
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
    // Its autonomy (`SessionSummary.autonomy`) is derived server-side from this and reflected in the
    // sessions list, not in this per-session chat view: nothing to patch here.
    case 'loop.wake':
    // Aggregated server-side for the Advisor (see `advisorSanghaStats`), not shown per session.
    case 'tool.error':
      return s
    case 'error':
      return { ...s, chat: [...s.chat, { kind: 'error', text: ev.message, at }] }
  }
}

export type Dialog = { kind: 'new-session'; project?: string } | { kind: 'add-project' } | { kind: 'dismiss'; id: string }
  | { kind: 'remove-project'; name: string }
  // `setAside`: asked on the way to setting it aside, where its name is all you'll see of it.
  | { kind: 'note'; id: string; setAside?: boolean }
  | { kind: 'closed-sessions' }
  | { kind: 'costs' }
  | { kind: 'providers' }
  | { kind: 'git' }
  | { kind: 'handoff'; id: string }
  | { kind: 'env'; id: string }
  | { kind: 'autonomy'; id: string }
  | { kind: 'host' }
  | { kind: 'mcp' }
  | { kind: 'mcp-library' }
  | { kind: 'advisor' } | null

type AppState = {
  profiles: SubagentProfile[]
  /** The models a session can run on, as the server offers them. */
  models: ModelChoice[]
  /** The model new sessions start with ('' : the agent's own), remembered across reloads. */
  defaultModel: string
  setDefaultModel: (id: string) => void
  projects: ProjectInfo[]
  /** Every session (and the orchestrator), kept live by the global event stream. */
  sessions: Record<string, SessionSummary>
  quota: Quota | null
  /** The share of the plan quota kept untouched, fed by the snapshot and every `reserve` event; null until the first lands. */
  reserve: QuotaReserveState | null
  /** The machine Sangha runs on, sampled every few seconds; null until the first sample lands. */
  host: HostReport | null
  /** The Advisor's `proposed` topics count and whether it is running a pass, fed by the global `advisor` event. */
  advisorBadge: { proposed: number; running: boolean } | null
  /** Bumped on every `{kind:'closed'}` global event: the closed sessions dialog refetches (arrivals, summaries, reopenings). */
  closedTick: number
  /** Bumped on every `{kind:'session'}` global event: what the cost chip watches, throttled, to refresh its total. */
  sessionsVersion: number
  /** No chime when a session finishes, remembered across reloads. */
  muted: boolean
  /** Session shown in the panel: a session id, the orchestrator id, or null. */
  selectedId: string | null
  view: SessionView
  selectedSubagent: string | null
  dialog: Dialog
  /** Who sessions commit as: undefined while loading, null when not set (git is closed to them). */
  gitIdentity: GitIdentity | null | undefined
  /** Sessions the user just interrupted: their next status change must not chime. */
  interruptedIds: Set<string>
  markInterrupted: (id: string) => void
  clearInterrupted: (id: string) => void
  apply: (env: Envelope) => void
  /** Apply a batch of events with a single re-render (a session's history arrives in bulk). */
  applyMany: (envs: Envelope[]) => void
  set: (p: Partial<AppState>) => void
  toggleMuted: () => void
}

const DEFAULT_MODEL_KEY = 'sangha.defaultModel'
const initialDefaultModel = (() => {
  try {
    return localStorage.getItem(DEFAULT_MODEL_KEY) ?? ''
  } catch {
    return ''
  }
})()

const MUTED_KEY = 'sangha.muted'
const initialMuted = (() => {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
})()

export const useApp = create<AppState>((set) => ({
  profiles: [],
  models: [],
  defaultModel: initialDefaultModel,
  setDefaultModel: (id) => {
    try {
      localStorage.setItem(DEFAULT_MODEL_KEY, id)
    } catch {
      // localStorage unavailable: the choice just won't persist across reloads.
    }
    set({ defaultModel: id })
  },
  projects: [],
  sessions: {},
  quota: null,
  reserve: null,
  host: null,
  advisorBadge: null,
  closedTick: 0,
  sessionsVersion: 0,
  muted: initialMuted,
  selectedId: null,
  view: emptyView(),
  selectedSubagent: null,
  dialog: null,
  gitIdentity: undefined,
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
  toggleMuted: () =>
    set((st) => {
      const next = !st.muted
      try {
        localStorage.setItem(MUTED_KEY, next ? '1' : '0')
      } catch {
        // localStorage unavailable: the toggle just won't persist across reloads.
      }
      return { muted: next }
    }),
}))
