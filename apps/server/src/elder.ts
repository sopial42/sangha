import { randomUUID } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ElderReportKind, ElderSettings, ElderSettingsPatch, ElderState, ElderTopic, ElderTopicStatus, Feedback, GlobalEvent, Quota, SessionSummary } from '@sangha/shared'
import type { Store } from './db'
import type { Providers } from './providers'
import { buildContext } from './elderContext'
import { due, type PendingSession } from './elderSchedule'
import { parseElderResponse } from './elderParse'
import { UserError } from './session'

const BACKOFF_STEPS_HOURS = [1, 2, 4, 6]
/** Backoff after consecutive failures of a scheduled pass (daily or weekly): 1 h, 2 h, 4 h, capped at 6 h. */
export function elderBackoffMs(consecutiveFailures: number): number {
  const step = Math.min(consecutiveFailures, BACKOFF_STEPS_HOURS.length) - 1
  return BACKOFF_STEPS_HOURS[Math.max(0, step)]! * 3600_000
}

/** An end-of-conversation pass is no longer retried for a session after this many failures in a row. */
const CONVERSATION_FAILURE_LIMIT = 3

export const DEFAULT_ELDER_SETTINGS: ElderSettings = {
  // The weekly pass is already protected by the quota guard: enabling the Advisor by default costs nothing.
  enabled: true,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: false },
  projects: [],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string', description: '5 to 15 lines, in English, for the user.' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'An existing topic id, to update it.' },
          scope: { type: 'string', description: "'manual' | 'sangha' | 'project:<name>'" },
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['scope', 'title', 'detail', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['report', 'topics'],
  additionalProperties: false,
}

const SYSTEM = `You are the Sangha Advisor. You review what is happening across the user's projects and sessions
and propose concrete improvements; you never change anything yourself.
Rules: group feedback that says the same thing into a single topic; never propose again a topic that was
already rejected (listed under Memory below); prefer updating an existing topic (reusing its id) over
creating a duplicate; at most 5 new topics per pass. Write "report" in plain, concrete English,
5 to 15 lines. Always answer in English.`

function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** Merges a partial change (levels and weekly included) and checks the result is still valid. */
export function mergeElderSettings(current: ElderSettings, patch: ElderSettingsPatch): ElderSettings {
  const next: ElderSettings = { ...current, ...patch, levels: { ...current.levels, ...patch.levels }, weekly: { ...current.weekly, ...patch.weekly } }
  if (typeof next.enabled !== 'boolean') throw new UserError('enabled must be true or false')
  if (typeof next.model !== 'string' || !next.model.trim()) throw new UserError('a model is required')
  if (!isHHMM(next.dailyAt)) throw new UserError('invalid daily time (HH:MM)')
  if (!Number.isInteger(next.weekly.day) || next.weekly.day < 0 || next.weekly.day > 6) throw new UserError('invalid weekly day (0-6)')
  if (!isHHMM(next.weekly.at)) throw new UserError('invalid weekly time (HH:MM)')
  if (!Number.isFinite(next.weekly.maxWeekUsedPct) || next.weekly.maxWeekUsedPct < 0 || next.weekly.maxWeekUsedPct > 100) throw new UserError('invalid weekly threshold (0-100)')
  if (!Number.isInteger(next.maxInputChars) || next.maxInputChars < 1000) throw new UserError('context limit too small (min 1000)')
  if (!Array.isArray(next.projects) || !next.projects.every((p) => typeof p === 'string')) throw new UserError('invalid followed projects')
  if (typeof next.levels.manual !== 'boolean' || typeof next.levels.sangha !== 'boolean' || typeof next.levels.project !== 'boolean') throw new UserError('invalid levels')
  return next
}

/** 👍 accepts, 👎 rejects, clicking the same vote again goes back to "proposed". */
export function nextVoteStatus(current: ElderTopicStatus, vote: 'up' | 'down'): ElderTopicStatus {
  const target: ElderTopicStatus = vote === 'up' ? 'accepted' : 'rejected'
  return current === target ? 'proposed' : target
}

/** Best effort, for display only: the real decision is still made by `due()`. */
export function nextRunAt(now: number, settings: ElderSettings): number | null {
  if (!settings.enabled) return null
  const d = new Date(now)
  if (settings.model.includes('::')) {
    const [h, m] = settings.dailyAt.split(':').map(Number)
    const next = new Date(d)
    next.setHours(h ?? 0, m ?? 0, 0, 0)
    if (next <= d) next.setDate(next.getDate() + 1)
    return next.getTime()
  }
  const [h, m] = settings.weekly.at.split(':').map(Number)
  const next = new Date(d)
  next.setDate(next.getDate() + ((settings.weekly.day - next.getDay() + 7) % 7))
  next.setHours(h ?? 0, m ?? 0, 0, 0)
  if (next <= d) next.setDate(next.getDate() + 7)
  return next.getTime()
}

export class Elder {
  private running = false
  private lastError: string | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(ev: Extract<GlobalEvent, { kind: 'elder' }>) => void>()
  // Backoff after a failed scheduled pass (daily or weekly): in memory is enough, reset on success.
  // "Run now" never calls `tick()`/`due()`, so it ignores this backoff by design.
  private consecutiveFailures = 0
  private retryAfter: number | null = null
  // Consecutive end-of-conversation failures, per session: past the limit, due() stops offering it (its feedback
  // stays pending, and the next unrestricted daily or weekly pass will pick it up).
  private conversationFailures = new Map<string, number>()

  constructor(
    private store: Store,
    private providers: Providers,
    private sessions: () => SessionSummary[],
    private quota: () => Quota | null,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 60_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  subscribe(fn: (ev: Extract<GlobalEvent, { kind: 'elder' }>) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private broadcast() {
    const proposed = this.store.elderTopics().filter((t) => t.status === 'proposed').length
    for (const fn of this.listeners) fn({ kind: 'elder', proposed, running: this.running })
  }

  settings(): ElderSettings {
    return this.store.setting<ElderSettings>('elder') ?? DEFAULT_ELDER_SETTINGS
  }

  setSettings(patch: ElderSettingsPatch): ElderSettings {
    const next = mergeElderSettings(this.settings(), patch)
    this.store.setSetting('elder', next)
    this.broadcast()
    return next
  }

  state(): ElderState {
    const settings = this.settings()
    return { settings, nextRunAt: nextRunAt(Date.now(), settings), running: this.running, lastError: this.lastError, topics: this.store.elderTopics(), reports: this.store.elderReports(), chat: this.store.elderChat() }
  }

  private pendingSessions(now: number): PendingSession[] {
    const pending = this.store.pendingFeedback()
    const hasPending = new Set(pending.map((f) => f.sessionId))
    const live: PendingSession[] = this.sessions()
      .filter((s) => hasPending.has(s.id))
      .map((s) => ({ id: s.id, archived: false, idleMs: s.status === 'waiting' ? now - (this.store.lastEvent(s.id, 'busy')?.at ?? now) : 0, hasPendingFeedback: true }))
    const liveIds = new Set(live.map((p) => p.id))
    const archived: PendingSession[] = this.store
      .archivedSessions()
      .filter((r) => hasPending.has(r.id) && !liveIds.has(r.id))
      .map((r) => ({ id: r.id, archived: true, idleMs: 0, hasPendingFeedback: true }))
    return [...live, ...archived]
  }

  private blockedSessions(): Set<string> {
    return new Set([...this.conversationFailures.entries()].filter(([, n]) => n >= CONVERSATION_FAILURE_LIMIT).map(([id]) => id))
  }

  /** Decides whether a pass is due and runs it. Driven by the timer; public (rather than private) for tests. */
  async tick() {
    if (this.running) return
    const pass = due(Date.now(), this.settings(), this.quota(), this.pendingSessions(Date.now()), { retryAfter: this.retryAfter, blockedSessions: this.blockedSessions() })
    if (!pass) return
    if (pass.kind === 'skipped') return this.skip()
    await this.runPass(pass.kind, pass.kind === 'conversation' ? pass.sessionId : undefined)
  }

  private skip() {
    this.store.addElderReport({ id: randomUUID(), kind: 'skipped', text: 'Week skipped: the plan quota was too heavily used.', topicIds: [], costUsd: null, tokens: null, createdAt: Date.now() })
    this.store.setSetting('elder', { ...this.settings(), lastRunAt: Date.now() })
    this.broadcast()
  }

  /** A scheduled or manual pass. `sessionId` limits the context to one session (end of conversation). */
  async runPass(kind: ElderReportKind, sessionId?: string) {
    if (this.running) return
    this.running = true
    this.lastError = null
    this.broadcast()
    try {
      const settings = this.settings()
      const since = settings.lastRunAt ?? 0
      const ctx = buildContext(settings, since, this.store, sessionId)
      if (ctx.newItems === 0 && kind !== 'manual') return
      const choice = await this.providers.choice(settings.model)
      if (!choice) throw new Error(`model unavailable: ${settings.model}`)
      const env = this.providers.env(choice.engine, choice.model)
      const knownIds = new Set(this.store.elderTopics().map((t) => t.id))
      const result = await this.callModel(choice.model ?? choice.id, env, ctx.text)
      const parsed = parseElderResponse(result.output, knownIds, settings.levels, settings.projects)
      if (!parsed) throw new Error('invalid model response')
      this.applyAnswer(kind, parsed, result.costUsd, result.tokens)
      // Only mark as processed the feedback actually sent to the model (after truncation and the 50 limit):
      // an item dropped by `buildContext` was never read and must not disappear from the queue.
      this.store.markFeedbackProcessed(ctx.feedbackIds, Date.now())
      // An end-of-conversation pass covers only one session: moving lastRunAt forward would make the next
      // daily pass miss the project summaries and Sangha signals of the skipped period.
      if (kind !== 'conversation') this.store.setSetting('elder', { ...settings, lastRunAt: Date.now() })
      this.onPassSettled(kind, sessionId, true)
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      console.error('[elder]', this.lastError)
      this.onPassSettled(kind, sessionId, false)
    } finally {
      this.running = false
      this.broadcast()
    }
  }

  /** Keeps the backoff counters up to date: reset on success, armed on failure, never for "manual",
   *  which ignores the backoff by design (it never goes through `due()`). */
  private onPassSettled(kind: ElderReportKind, sessionId: string | undefined, ok: boolean) {
    if (kind === 'manual') return
    if (kind === 'conversation') {
      if (!sessionId) return
      if (ok) this.conversationFailures.delete(sessionId)
      else this.conversationFailures.set(sessionId, (this.conversationFailures.get(sessionId) ?? 0) + 1)
      return
    }
    if (ok) {
      this.consecutiveFailures = 0
      this.retryAfter = null
    } else {
      this.consecutiveFailures++
      this.retryAfter = Date.now() + elderBackoffMs(this.consecutiveFailures)
    }
  }

  private applyAnswer(kind: ElderReportKind, parsed: { report: string; topics: { id?: string; scope: string; title: string; detail: string; evidence: string[] }[] }, costUsd: number | null, tokens: number | null) {
    const now = Date.now()
    const topicIds: string[] = []
    for (const t of parsed.topics) {
      const existing = t.id ? this.store.elderTopic(t.id) : null
      const id = existing?.id ?? randomUUID()
      const topic: ElderTopic = { id, scope: t.scope, title: t.title, detail: t.detail, evidence: t.evidence, status: existing?.status ?? 'proposed', createdAt: existing?.createdAt ?? now, updatedAt: now }
      this.store.upsertElderTopic(topic)
      topicIds.push(id)
    }
    this.store.addElderReport({ id: randomUUID(), kind, text: parsed.report, topicIds, costUsd, tokens, createdAt: now })
  }

  private async callModel(model: string, env: Record<string, string>, input: string): Promise<{ output: unknown; costUsd: number | null; tokens: number | null }> {
    const q = query({ prompt: input, options: { model, systemPrompt: SYSTEM, tools: [], settingSources: [], plugins: [], persistSession: false, maxTurns: 3, outputFormat: { type: 'json_schema', schema: ANSWER_SCHEMA }, env } })
    for await (const m of q) {
      if (m.type !== 'result') continue
      if (m.subtype !== 'success') return { output: null, costUsd: null, tokens: null }
      return { output: m.structured_output, costUsd: m.total_cost_usd, tokens: m.usage.input_tokens + m.usage.output_tokens }
    }
    return { output: null, costUsd: null, tokens: null }
  }

  voteTopic(id: string, vote: 'up' | 'down'): ElderTopic {
    const t = this.store.elderTopic(id)
    if (!t) throw new UserError('unknown topic')
    const updated: ElderTopic = { ...t, status: nextVoteStatus(t.status, vote), updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  doneTopic(id: string): ElderTopic {
    const t = this.store.elderTopic(id)
    if (!t) throw new UserError('unknown topic')
    if (t.status !== 'accepted') throw new UserError('only an accepted topic can be marked done')
    const updated: ElderTopic = { ...t, status: 'done', updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  addFeedback(input: { sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }): Feedback {
    if (input.rating !== undefined && input.rating !== 'up' && input.rating !== 'down') throw new UserError('invalid rating (up or down)')
    const f: Feedback = {
      id: randomUUID(),
      sessionId: input.sessionId,
      eventSeq: input.eventSeq ?? null,
      rating: input.rating ?? null,
      comment: input.comment?.trim() || null,
      excerpt: this.store.excerptAround(input.sessionId, input.eventSeq ?? null),
      createdAt: Date.now(),
      processedAt: null,
    }
    this.store.addFeedback(f)
    this.broadcast()
    return f
  }

  /** A free question, outside the schedule: open topics, last 3 reports, last 20 messages. The question and the
   *  answer are saved only if the model actually answered: otherwise nothing is written to the chat. */
  async ask(text: string): Promise<{ reply: string }> {
    const settings = this.settings()
    const choice = await this.providers.choice(settings.model)
    if (!choice) throw new UserError(`model unavailable: ${settings.model}`)
    const env = this.providers.env(choice.engine, choice.model)
    const topics = this.store.elderTopics().filter((t) => t.status !== 'rejected')
    const reports = this.store.elderReports(3)
    const history = this.store.elderChat(20)
    const input = [
      topics.length ? `Topics:\n${topics.map((t) => `- [${t.status}] ${t.title}: ${t.detail}`).join('\n')}` : '',
      reports.length ? `Latest reports:\n${reports.map((r) => `- ${r.text}`).join('\n')}` : '',
      history.length ? history.map((h) => `${h.role === 'user' ? 'User' : 'Advisor'}: ${h.text}`).join('\n') : '',
      `User: ${text}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    let reply = ''
    let detail: string | null = null
    try {
      const q = query({ prompt: input, options: { model: choice.model ?? choice.id, systemPrompt: SYSTEM, tools: [], settingSources: [], plugins: [], persistSession: false, maxTurns: 3, env } })
      for await (const m of q) {
        if (m.type !== 'result') continue
        if (m.subtype === 'success') reply = m.result
        else detail = `failed (${m.subtype})`
      }
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e)
    }
    if (!reply.trim()) throw new UserError(`The Advisor could not answer: ${detail ?? 'empty answer'}`)

    this.store.addElderChatMessage('user', text, Date.now())
    this.store.addElderChatMessage('elder', reply, Date.now())
    this.broadcast()
    return { reply }
  }
}
