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
/** Recul après un échec consécutif d'un passage programmé (quotidien ou hebdomadaire) : 1 h, 2 h, 4 h, plafonné à 6 h. */
export function elderBackoffMs(consecutiveFailures: number): number {
  const step = Math.min(consecutiveFailures, BACKOFF_STEPS_HOURS.length) - 1
  return BACKOFF_STEPS_HOURS[Math.max(0, step)]! * 3600_000
}

/** Un passage « fin de conversation » n'est plus retenté pour une même session passé ce nombre d'échecs de suite. */
const CONVERSATION_FAILURE_LIMIT = 3

export const DEFAULT_ELDER_SETTINGS: ElderSettings = {
  // Le passage hebdomadaire est déjà protégé par la garde de quota : activer Ananda par défaut ne mange rien.
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
    report: { type: 'string', description: '5 à 15 lignes, en français, pour l’utilisateur.' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Un id de sujet existant, pour le mettre à jour.' },
          scope: { type: 'string', description: "'manual' | 'sangha' | 'project:<nom>'" },
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

const SYSTEM = `Tu es Ananda, un vieux moine bienveillant assis sous l'arbre de la Bodhi. Tu relis ce qui se passe dans
le monastère et proposes des suggestions d'amélioration concrètes ; tu ne modifies jamais rien toi-même.
Règles : regroupe les retours qui disent la même chose en un seul sujet ; ne reproposes jamais un sujet déjà
rejeté (listé dans la Mémoire ci-dessous) ; préfère mettre à jour un sujet existant (en reprenant son id) plutôt
qu'en créer un doublon ; au plus 5 sujets nouveaux par passage. Écris "report" en français simple et concret,
5 à 15 lignes.`

function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** Fusionne un changement partiel (niveaux/hebdomadaire inclus) et vérifie qu'il reste sain. */
export function mergeElderSettings(current: ElderSettings, patch: ElderSettingsPatch): ElderSettings {
  const next: ElderSettings = { ...current, ...patch, levels: { ...current.levels, ...patch.levels }, weekly: { ...current.weekly, ...patch.weekly } }
  if (typeof next.enabled !== 'boolean') throw new UserError('enabled doit être vrai ou faux')
  if (typeof next.model !== 'string' || !next.model.trim()) throw new UserError('un moteur est requis')
  if (!isHHMM(next.dailyAt)) throw new UserError('heure quotidienne invalide (HH:MM)')
  if (!Number.isInteger(next.weekly.day) || next.weekly.day < 0 || next.weekly.day > 6) throw new UserError('jour hebdomadaire invalide (0-6)')
  if (!isHHMM(next.weekly.at)) throw new UserError('heure hebdomadaire invalide (HH:MM)')
  if (!Number.isFinite(next.weekly.maxWeekUsedPct) || next.weekly.maxWeekUsedPct < 0 || next.weekly.maxWeekUsedPct > 100) throw new UserError('seuil hebdomadaire invalide (0-100)')
  if (!Number.isInteger(next.maxInputChars) || next.maxInputChars < 1000) throw new UserError('plafond de contexte trop petit (min 1000)')
  if (!Array.isArray(next.projects) || !next.projects.every((p) => typeof p === 'string')) throw new UserError('projets suivis invalides')
  if (typeof next.levels.manual !== 'boolean' || typeof next.levels.sangha !== 'boolean' || typeof next.levels.project !== 'boolean') throw new UserError('niveaux invalides')
  return next
}

/** 👍 accepte, 👎 rejette, recliquer le même vote revient à « proposed ». */
export function nextVoteStatus(current: ElderTopicStatus, vote: 'up' | 'down'): ElderTopicStatus {
  const target: ElderTopicStatus = vote === 'up' ? 'accepted' : 'rejected'
  return current === target ? 'proposed' : target
}

/** Best-effort, pour l'affichage seulement : la vraie décision reste celle de `due()`. */
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
  // Recul après l'échec d'un passage programmé (quotidien/hebdomadaire) : en mémoire suffit, remis à zéro au
  // succès. « Médite maintenant » n'appelle jamais `tick()`/`due()` : il ignore ce recul par construction.
  private consecutiveFailures = 0
  private retryAfter: number | null = null
  // Échecs de suite d'un passage « fin de conversation », par session : passé la limite, due() ne la reproposera
  // plus (ses retours restent en attente : le prochain passage quotidien/hebdomadaire, non restreint, les reprendra).
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

  /** Décide si un passage est dû et le lance. Piloté par le minuteur ; exposé (plutôt que privé) pour les tests. */
  async tick() {
    if (this.running) return
    const pass = due(Date.now(), this.settings(), this.quota(), this.pendingSessions(Date.now()), { retryAfter: this.retryAfter, blockedSessions: this.blockedSessions() })
    if (!pass) return
    if (pass.kind === 'skipped') return this.skip()
    await this.runPass(pass.kind, pass.kind === 'conversation' ? pass.sessionId : undefined)
  }

  private skip() {
    this.store.addElderReport({ id: randomUUID(), kind: 'skipped', text: 'Semaine sautée : quota du plan trop utilisé.', topicIds: [], costUsd: null, tokens: null, createdAt: Date.now() })
    this.store.setSetting('elder', { ...this.settings(), lastRunAt: Date.now() })
    this.broadcast()
  }

  /** Un passage programmé ou manuel. `sessionId` : restreint le contexte à une session (fin de conversation). */
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
      if (!choice) throw new Error(`modèle indisponible : ${settings.model}`)
      const env = this.providers.env(choice.engine, choice.model)
      const knownIds = new Set(this.store.elderTopics().map((t) => t.id))
      const result = await this.callModel(choice.model ?? choice.id, env, ctx.text)
      const parsed = parseElderResponse(result.output, knownIds, settings.levels, settings.projects)
      if (!parsed) throw new Error('réponse du modèle invalide')
      this.applyAnswer(kind, parsed, result.costUsd, result.tokens)
      // Ne marque traités que les retours réellement envoyés au modèle (après troncature et limite de 50) :
      // un retour écarté par `buildContext` n'a jamais été lu, il ne doit pas disparaître de la file.
      this.store.markFeedbackProcessed(ctx.feedbackIds, Date.now())
      // Une « fin de conversation » ne couvre qu'une session : avancer lastRunAt lui ferait perdre, au
      // passage quotidien suivant, les résumés de projet et les signaux Sangha de la période sautée.
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

  /** Tient les compteurs de recul à jour : remis à zéro au succès, armés à l'échec — jamais pour « manual »,
   *  qui ignore le recul par construction (il ne passe jamais par `due()`). */
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
    if (!t) throw new UserError('sujet inconnu')
    const updated: ElderTopic = { ...t, status: nextVoteStatus(t.status, vote), updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  doneTopic(id: string): ElderTopic {
    const t = this.store.elderTopic(id)
    if (!t) throw new UserError('sujet inconnu')
    if (t.status !== 'accepted') throw new UserError('seul un sujet accepté peut être marqué fait')
    const updated: ElderTopic = { ...t, status: 'done', updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  addFeedback(input: { sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }): Feedback {
    if (input.rating !== undefined && input.rating !== 'up' && input.rating !== 'down') throw new UserError('note invalide (up ou down)')
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

  /** Une question libre, hors programme : sujets ouverts, 3 derniers rapports, 20 derniers messages. N'enregistre
   *  la question et la réponse que si le modèle a bien répondu : sinon rien n'est écrit dans la discussion. */
  async ask(text: string): Promise<{ reply: string }> {
    const settings = this.settings()
    const choice = await this.providers.choice(settings.model)
    if (!choice) throw new UserError(`modèle indisponible : ${settings.model}`)
    const env = this.providers.env(choice.engine, choice.model)
    const topics = this.store.elderTopics().filter((t) => t.status !== 'rejected')
    const reports = this.store.elderReports(3)
    const history = this.store.elderChat(20)
    const input = [
      topics.length ? `Sujets :\n${topics.map((t) => `- [${t.status}] ${t.title} : ${t.detail}`).join('\n')}` : '',
      reports.length ? `Derniers rapports :\n${reports.map((r) => `- ${r.text}`).join('\n')}` : '',
      history.length ? history.map((h) => `${h.role === 'user' ? 'Toi' : 'Ananda'} : ${h.text}`).join('\n') : '',
      `Toi : ${text}`,
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
        else detail = `échec (${m.subtype})`
      }
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e)
    }
    if (!reply.trim()) throw new UserError(`Ananda n'a pas pu répondre : ${detail ?? 'réponse vide'}`)

    this.store.addElderChatMessage('user', text, Date.now())
    this.store.addElderChatMessage('elder', reply, Date.now())
    this.broadcast()
    return { reply }
  }
}
