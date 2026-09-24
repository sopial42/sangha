import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { query, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  BUDDHA_SESSION_ID,
  type Envelope,
  type GlobalEvent,
  type MonasteryEvent,
  type NoviceSummary,
  type Quota,
  type SessionStatus,
  type SessionSummary,
} from '@sangha/shared'
import { config } from './config'
import type { SessionRow, Shepherd, Store } from './db'
import { addWorktree, isGitRepo, removeWorktree, worktreeState, type WorktreeState } from './git'
import { EXTERNAL_PREFIX, type Observer } from './observer'
import { transcriptPath, type Projects } from './projects'
import { readTailLines } from './files'
import { Normalizer } from './normalize'
import { relayToPeer } from './messenger'
import { doing, progress, recap, type Progress } from './recap'
import { priestOptions } from './roles'
import { contextTokens, parseLine, TranscriptReader } from './transcript'
import { CostMeter } from './cost'
import { isHandoff, nextDelay, parseAnswer, shepherdPrompt, type ShepherdAnswer } from './shepherd'

type Listener = (env: Envelope) => void
type GlobalListener = (ev: GlobalEvent) => void

/** Local plugins (superpowers, ui-ux-pro-max, frontend-design) fetched by `make plugins`. */
function localPlugins() {
  if (!existsSync(config.pluginsDir)) return []
  return readdirSync(config.pluginsDir)
    .map((name) => join(config.pluginsDir, name))
    .filter((dir) => existsSync(join(dir, '.claude-plugin')))
    .map((path) => ({ type: 'local' as const, path }))
}

/** Pull-based queue feeding user messages into a long-lived Claude Code process. */
class Inbox {
  private items: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private closed = false

  push(text: string) {
    this.items.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    this.wake?.()
  }

  close() {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.items.shift()
      if (next) yield next
      else if (this.closed) return
      else await new Promise<void>((r) => (this.wake = r))
    }
  }
}

// Events that change what the monastery overview shows.
const SUMMARY_EVENTS = new Set<MonasteryEvent['t']>(['busy', 'background', 'monk.summoned', 'monk.tool', 'monk.done', 'buddha.tool', 'turn.done', 'error', 'user.message', 'recap'])

/**
 * One priest (or Buddha) = one long-lived Claude Code process in streaming-input mode.
 * It stays open so background novices can report back and the priest can react.
 * After idling it is closed, and the next message resumes it from Claude's transcript.
 */
class LiveSession {
  private inbox = new Inbox()
  private q: Query
  private normalizer = new Normalizer()
  private turnRunning = false
  private idleTimer: NodeJS.Timeout | undefined
  busy = false
  activity: string | null = null
  novices = new Map<string, NoviceSummary>()
  /** Background work the turn left running (a script, a novice): he waits on it, so he is still at work. */
  private background: { id: string; type: string; description: string }[] = []

  constructor(
    row: SessionRow,
    cwd: string,
    options: Partial<Options>,
    private emit: (ev: MonasteryEvent) => void,
    private onClosed: () => void,
    onClaudeSessionId: (id: string) => void,
  ) {
    const env = { ...process.env } as Record<string, string>
    delete env.ANTHROPIC_API_KEY // belt and braces: never bill the API
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd,
        plugins: localPlugins(),
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        forwardSubagentText: true,
        resume: row.claudeSessionId ?? undefined,
        env,
        stderr: (d) => console.error(`[claude ${row.id.slice(0, 8)}] ${d.trimEnd()}`),
        ...options,
      },
    })
    void this.pump(onClaudeSessionId)
  }

  send(text: string) {
    this.turnRunning = true
    this.refreshBusy()
    this.inbox.push(text)
  }

  async interrupt() {
    await this.q.interrupt().catch(() => undefined)
  }

  close() {
    clearTimeout(this.idleTimer)
    this.inbox.close()
    this.q.close()
  }

  private track(ev: MonasteryEvent) {
    // He may start a turn on his own (woken by a background task's notification): any word or tool of his means a turn runs.
    if (ev.t === 'buddha.delta' || ev.t === 'buddha.text' || ev.t === 'buddha.tool' || ev.t === 'monk.summoned') this.turnRunning = true
    switch (ev.t) {
      case 'monk.summoned':
        this.novices.set(ev.monkId, { monkId: ev.monkId, agentType: ev.agentType, description: ev.description, lastTool: null })
        break
      case 'monk.tool': {
        const n = this.novices.get(ev.monkId)
        if (n) n.lastTool = { tool: ev.tool, summary: ev.summary }
        break
      }
      case 'monk.done':
        this.novices.delete(ev.monkId)
        break
      case 'buddha.tool':
        this.activity = ev.summary ? `${ev.tool} · ${ev.summary}` : ev.tool
        break
      case 'turn.done':
        this.turnRunning = false
        this.activity = this.waitingOn()
        break
      case 'background':
        this.background = ev.tasks
        if (!this.turnRunning) this.activity = this.waitingOn()
        break
    }
  }

  private async pump(onClaudeSessionId: (id: string) => void) {
    try {
      for await (const m of this.q) {
        for (const ev of this.normalizer.push(m)) {
          if (ev.t === 'session.started') onClaudeSessionId(ev.claudeSessionId)
          this.track(ev)
          this.emit(ev)
        }
        this.refreshBusy()
      }
    } catch (err) {
      this.emit({ t: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.turnRunning = false
      this.novices.clear()
      this.background = []
      this.activity = null
      this.refreshBusy()
      this.onClosed()
    }
  }

  /** What he waits on once his turn is over: the background script still running, if any. */
  private waitingOn() {
    const t = this.background.find((k) => k.type !== 'local_agent')
    return t ? `En attente · ${t.description}` : null
  }

  private refreshBusy() {
    const busy = this.turnRunning || this.novices.size > 0 || this.background.length > 0
    if (busy !== this.busy) {
      this.busy = busy
      this.emit({ t: 'busy', busy })
    }
    clearTimeout(this.idleTimer)
    if (!busy) this.idleTimer = setTimeout(() => this.close(), config.idleCloseMs)
  }
}

export type CreateSession = { project: string; agent: string; prompt: string; baseRef?: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

/** Sent to an outside session once its work has moved on to a fresh session. */
export const FAREWELL =
  'La suite de ton travail continue dans une session neuve, qui a reçu ta passation. Arrête ici tout travail : ne lance ni ne relance plus de sous-agents, et ne réponds plus aux notifications de tâches. Tu peux être fermée.'

export class Sessions {
  private live = new Map<string, LiveSession>()
  private listeners = new Map<string, Set<Listener>>()
  private globalListeners = new Set<GlobalListener>()
  private observer: Observer | null = null
  private progressCache = new Map<string, { key: string; value: Promise<Progress | null> }>()
  // "What is he doing" sentences for working sessions, refreshed at most every DOING_EVERY_MS.
  private doings = new Map<string, { at: number; key: string; text: string }>()

  /** The "what is he doing" sentence, from memory or from the base (after a restart). */
  private doingOf(id: string) {
    let d = this.doings.get(id)
    if (!d) {
      const n = this.store.note<string>(id, 'doing')
      if (n) this.doings.set(id, (d = { at: n.at, key: n.key, text: n.value }))
    }
    return d
  }
  private doingBusy = false
  private contexts = new Map<string, { mtime: number; tokens: number | null }>()
  private meter = new CostMeter()
  private renewing = false
  quota: Quota | null = null

  constructor(
    private store: Store,
    private projects: Projects,
    private buddhaOptions: (sessions: Sessions) => Partial<Options>,
  ) {
    this.quota = store.latestQuota()
    // No session process survives a server restart: novices still marked as working died with it.
    for (const row of store.listSessions()) {
      for (const monkId of store.danglingNovices(row.id)) {
        store.append(row.id, { t: 'monk.done', monkId, status: 'stopped', summary: 'Interrompu : le serveur s’est arrêté pendant son travail.' })
      }
    }
    if (!store.getSession(BUDDHA_SESSION_ID)) {
      store.createSession({
        id: BUDDHA_SESSION_ID,
        project: '',
        agent: 'buddha',
        title: 'Bouddha',
        createdAt: Date.now(),
        claudeSessionId: null,
        branch: null,
        worktree: null,
        baseSha: null,
        archivedAt: null,
        lastSeenSeq: 0,
      })
    }
  }

  async create({ project, agent, prompt, baseRef }: CreateSession): Promise<SessionSummary> {
    if (!this.projects.exists(project)) throw new UserError(`projet inconnu : ${project}`)
    if (!this.projects.agentsOf(project).some((a) => a.id === agent)) throw new UserError(`agent inconnu pour ${project} : ${agent}`)
    if (!prompt.trim()) throw new UserError('consigne vide')
    const id = crypto.randomUUID()
    const name = `${slug(agent)}-${id.slice(0, 6)}`
    const repo = this.projects.dir(project)
    let branch: string | null = null
    let worktree: string | null = null
    let baseSha: string | null = null
    if (isGitRepo(repo)) {
      branch = `sangha/${name}`
      worktree = join(config.workspacesDir, '.worktrees', project, name)
      baseSha = await addWorktree(repo, worktree, branch, baseRef?.trim() || 'HEAD').catch((e: Error) => {
        throw new UserError(e.message)
      })
    }
    const row: SessionRow = {
      id,
      project,
      agent,
      title: prompt.trim().split('\n')[0]!.slice(0, 80),
      createdAt: Date.now(),
      claudeSessionId: null,
      branch,
      worktree,
      baseSha,
      archivedAt: null,
      lastSeenSeq: 0,
    }
    this.store.createSession(row)
    this.send(id, prompt.trim())
    return this.summary(row)
  }

  /** Outside Claude Code sessions join the monastery as read-only priests. */
  observe(observer: Observer) {
    this.observer = observer
  }

  /** Called by the observer when outside sessions change. */
  externalChanged(changed: SessionSummary[], removed: string[]) {
    for (const session of changed) for (const fn of this.globalListeners) fn({ kind: 'session', session: this.withDoing(session) })
    for (const id of removed) for (const fn of this.globalListeners) fn({ kind: 'removed', id })
  }

  /**
   * Your reply to any session. A Sangha priest gets it directly. An outside session still running in its
   * terminal gets it relayed through Claude Code's cross-session messaging; one that ended is resumed here.
   */
  async reply(id: string, text: string): Promise<{ via: 'sangha' } | { via: 'peer'; to: string } | { via: 'adopted'; id: string }> {
    if (!id.startsWith(EXTERNAL_PREFIX)) {
      this.send(id, text)
      return { via: 'sangha' }
    }
    const s = this.observer?.summaryOf(id)
    if (!s) throw new UserError('session introuvable')
    const proc = this.observer?.procOf(id)
    if (proc) {
      const r = await relayToPeer({ cwd: proc.cwd, startedAt: s.createdAt }, text)
      if (!r.ok) throw new UserError(`message non transmis : ${r.error}`)
      return { via: 'peer', to: r.to }
    }
    // Its terminal is closed: nothing to collide with, Sangha takes the session over.
    const row: SessionRow = {
      id: crypto.randomUUID(),
      project: s.project,
      agent: s.agent,
      title: s.title,
      createdAt: Date.now(),
      claudeSessionId: s.claudeSessionId,
      branch: s.branch,
      worktree: s.cwd,
      baseSha: null,
      archivedAt: null,
      lastSeenSeq: 0,
    }
    this.store.createSession(row)
    this.observer?.hide(id)
    this.send(row.id, text)
    return { via: 'adopted', id: row.id }
  }

  send(id: string, text: string) {
    if (id.startsWith(EXTERNAL_PREFIX)) throw new UserError('utilise reply() pour une session externe')
    const row = this.store.getSession(id)
    if (!row || row.archivedAt) throw new UserError('session inconnue')
    this.emit(id, { t: 'user.message', text })
    this.ensureLive(row).send(text)
  }

  /** Relaunch a session the server stopped mid-work. */
  resume(id: string) {
    this.send(id, 'The Sangha server restarted while you were working. Check where you stopped, then continue.')
  }

  async interrupt(id: string) {
    await this.live.get(id)?.interrupt()
  }

  seen(id: string) {
    if (id.startsWith(EXTERNAL_PREFIX)) return this.observer?.seen(id)
    this.store.markSeen(id)
    this.broadcastSession(id)
  }

  /** Archive a priest and remove his worktree. Refuses when work would be lost, unless forced. */
  async archive(id: string, force: boolean): Promise<{ ok: true } | { ok: false; state: WorktreeState; branch: string | null }> {
    if (id.startsWith(EXTERNAL_PREFIX)) {
      // An outside session is only sent away from the courtyard; its terminal keeps running.
      this.observer?.hide(id)
      return { ok: true }
    }
    const row = this.store.getSession(id)
    if (!row || id === BUDDHA_SESSION_ID) throw new UserError('session inconnue')
    let state: WorktreeState = { dirty: 0, ahead: 0 }
    if (row.worktree && row.baseSha) {
      state = await worktreeState(row.worktree, row.baseSha)
      if (state.dirty > 0 && !force) return { ok: false, state, branch: row.branch }
    }
    this.live.get(id)?.close()
    this.live.delete(id)
    // Only worktrees Sangha created (they have a base commit); an adopted session's folder is yours.
    if (row.worktree && row.branch && row.baseSha) await removeWorktree(this.projects.dir(row.project), row.worktree, row.branch, state.ahead)
    this.store.archive(id)
    for (const fn of this.globalListeners) fn({ kind: 'removed', id })
    return { ok: true }
  }

  /**
   * Dismiss every priest of a project, then take the project out. Refuses when work would be lost
   * (uncommitted changes in a priest's worktree, or in a clone that would be deleted) unless forced.
   */
  async removeProject(name: string, force: boolean): Promise<{ ok: true } | { ok: false; dirty: { title: string; files: number }[] }> {
    if (!this.projects.exists(name)) throw new UserError(`projet inconnu : ${name}`)
    const priests = this.store.listSessions().filter((r) => r.project === name && r.id !== BUDDHA_SESSION_ID)
    if (!force) {
      const dirty: { title: string; files: number }[] = []
      for (const r of priests) {
        if (!r.worktree || !r.baseSha) continue
        const st = await worktreeState(r.worktree, r.baseSha)
        if (st.dirty) dirty.push({ title: r.title, files: st.dirty })
      }
      const { path, local } = this.projects.info(name)
      if (!local && isGitRepo(path)) {
        const st = await worktreeState(path, 'HEAD')
        if (st.dirty) dirty.push({ title: `clone ${name}`, files: st.dirty })
      }
      if (dirty.length) return { ok: false, dirty }
    }
    for (const r of priests) await this.archive(r.id, true)
    this.projects.remove(name)
    for (const fn of this.globalListeners) fn({ kind: 'projects' })
    return { ok: true }
  }

  /** Tell every open monastery the list of projects changed. */
  projectsChanged() {
    for (const fn of this.globalListeners) fn({ kind: 'projects' })
  }

  summaries(): SessionSummary[] {
    return [...this.store.listSessions().map((r) => this.summary(r)), ...(this.observer?.summaries() ?? []).map((s) => this.withDoing(s))]
  }

  summaryOf(id: string): SessionSummary | null {
    if (id.startsWith(EXTERNAL_PREFIX)) {
      const s = this.observer?.summaryOf(id)
      return s ? this.withDoing(s) : null
    }
    const row = this.store.getSession(id)
    return row && !row.archivedAt ? this.summary(row) : null
  }

  /** Change marker of a session's history: a new marker means there is something new to summarize. */
  private historyKey(id: string): string {
    const file = id.startsWith(EXTERNAL_PREFIX) ? this.observer?.fileOf(id) : null
    return file ? String(statSync(file).mtimeMs) : String(this.store.events(id).length)
  }

  /** Summaries carry the latest "what is he doing" sentence while the session works, and his silence. */
  private withDoing(s: SessionSummary): SessionSummary {
    return {
      ...s,
      doing: s.status === 'working' ? (this.doingOf(s.id)?.text ?? null) : null,
      silenced: this.store.silencedIds().has(s.id),
      renewal: this.renewalState(s.id),
      shepherd: this.shepherdState(s.id),
      cost: this.costOf(s.id),
    }
  }

  /** API-price cost of a session so far, including what the sessions it took over from had cost. */
  private costOf(id: string): number | null {
    if (id === BUDDHA_SESSION_ID) return null
    const file = this.transcriptOf(id)
    const carried = this.store.carriedCost(id)
    return file || carried ? (file ? this.meter.session(file) : 0) + carried : null
  }

  /** Claude Code transcript of a session, if it has one yet. */
  private transcriptOf(id: string): string | null {
    if (id.startsWith(EXTERNAL_PREFIX)) return this.observer?.fileOf(id) ?? null
    const row = this.store.getSession(id)
    if (!row?.claudeSessionId) return null
    const cwd = row.worktree ?? (this.projects.exists(row.project) ? this.projects.dir(row.project) : null)
    const file = cwd ? transcriptPath(cwd, row.claudeSessionId) : null
    return file && existsSync(file) ? file : null
  }

  private renewalState(id: string): 'asked' | 'postponed' | null {
    const r = this.store.renewal(id)
    return r && r.state !== 'done' ? r.state : null
  }

  private shepherdState(id: string): SessionSummary['shepherd'] {
    const s = this.store.shepherd(id)
    return s && s.state !== 'done' ? { state: s.state, nextAt: s.nextAt, note: s.note } : null
  }

  /** Context weight of a Sangha session, read from its Claude Code transcript (cached by file date). */
  private contextOf(row: SessionRow): number | null {
    if (!row.claudeSessionId) return null
    const cwd = row.worktree ?? (this.projects.exists(row.project) ? this.projects.dir(row.project) : null)
    if (!cwd) return null
    const file = transcriptPath(cwd, row.claudeSessionId)
    if (!existsSync(file)) return null
    const mtime = statSync(file).mtimeMs
    const cached = this.contexts.get(row.id)
    if (cached?.mtime === mtime) return cached.tokens
    const tokens = contextTokens(readTailLines(file, 1024 * 1024).map(parseLine).filter((l) => l !== null))
    this.contexts.set(row.id, { mtime, tokens })
    return tokens
  }

  // ——— Moving on to a fresh session when the context gets heavy ———

  /**
   * Every few seconds: a stopped session whose context passed 400K (then each further 100K) is asked
   * whether to continue in a fresh session. Its answer decides: yes, the fresh session starts from the
   * handoff it wrote; no or later, we wait for the next 100K.
   */
  startRenewalLoop() {
    setInterval(() => void this.tickRenewals(), 15_000)
  }

  /** Ask a session now, whatever its size (the "Repartir à neuf" button). */
  async askRenewal(id: string) {
    const s = this.summaryOf(id)
    if (!s || id === BUDDHA_SESSION_ID) throw new UserError('session inconnue')
    if (s.status === 'working') throw new UserError('il travaille : attends qu’il s’arrête')
    await this.ask(s)
  }

  private async ask(s: SessionSummary) {
    const k = Math.round((s.context ?? 0) / 1000)
    const text = `Ton contexte pèse maintenant environ ${k}K tokens. Nous allons continuer dans une session neuve pour repartir avec un contexte léger. Penses-tu que c'est une bonne idée maintenant ?

Le fait que ce soit la fin de la journée, ou que tu t'apprêtes à t'arrêter pour ce soir, n'est pas une raison de refuser : c'est même le cas où une session neuve est la plus utile, puisque c'est elle qui permettra de reprendre le travail demain matin, l'esprit frais, dans la même lignée.

Avant de répondre, vérifie que ce qui compte pour le projet à long terme est bien écrit dans les fichiers que le repo prévoit pour ça (README, docs, CLAUDE.md…) ; sans excès de zèle, ajoute seulement ce qui manque vraiment.

Réponds sur la première ligne par OUI, NON ou PLUS TARD.
Si OUI, écris ensuite, sous le titre « PASSATION », tout ce dont la nouvelle session aura besoin pour continuer sans toi : l'objectif, les décisions prises, l'état actuel, les prochaines étapes, et les fichiers et pièges importants.`
    const askedAt = Date.now()
    this.store.setRenewal(s.id, { bucket: Math.floor((s.context ?? 0) / 100_000) * 100_000, state: 'asked', askedAt })
    this.broadcastSession(s.id)
    await this.reply(s.id, text)
  }

  private async tickRenewals() {
    if (this.renewing) return
    this.renewing = true
    try {
      for (const s of this.summaries()) {
        if (s.id === BUDDHA_SESSION_ID) continue
        const sh = this.store.shepherd(s.id)
        if (sh && (sh.state === 'pending' || sh.state === 'asked')) {
          await this.tickShepherd(s, sh).catch((e) => console.error('[shepherd]', e instanceof Error ? e.message : e))
          continue
        }
        if (s.status === 'working' || s.silenced) continue
        const rec = this.store.renewal(s.id)
        if (rec?.state === 'asked') {
          if (s.status === 'waiting') await this.readAnswer(s, rec.askedAt)
          continue
        }
        if (rec?.state === 'done' || s.status !== 'waiting' || (s.context ?? 0) < 400_000) continue
        // An outside session whose terminal is closed cannot answer: leave it be.
        if (s.external && !s.alive) continue
        const bucket = Math.floor(s.context! / 100_000) * 100_000
        if (!rec || bucket > rec.bucket) await this.ask(s).catch((e) => console.error('[renewal ask]', e instanceof Error ? e.message : e))
      }
    } finally {
      this.renewing = false
    }
  }

  /** His words since the question. */
  private answerSince(id: string, askedAt: number): string {
    return this.wordsSince(id, askedAt).join('\n\n')
  }

  /** Each message he wrote after `since`. */
  private wordsSince(id: string, since: number): string[] {
    if (!id.startsWith(EXTERNAL_PREFIX)) {
      return this.store
        .events(id)
        .filter((e) => e.at > since && e.ev.t === 'buddha.text')
        .map((e) => (e.ev.t === 'buddha.text' ? e.ev.text : ''))
    }
    const file = this.observer?.fileOf(id)
    if (!file) return []
    const reader = new TranscriptReader()
    return readTailLines(file, 2 * 1024 * 1024)
      .map(parseLine)
      .filter((l) => l !== null && l.timestamp && Date.parse(l.timestamp) > since)
      .flatMap((l) => reader.push(l!))
      .map((e) => (e.t === 'buddha.text' ? e.text : ''))
      .filter(Boolean)
  }

  // ——— Buddha seeing a priest through to a fresh session ———

  /** Hand (or take back) a priest's move to a fresh session to Buddha. */
  shepherd(id: string, on: boolean) {
    const s = this.summaryOf(id)
    if (!s || id === BUDDHA_SESSION_ID) throw new UserError('session inconnue')
    if (!on) {
      this.store.setShepherd(id, null)
    } else {
      if (s.external && !s.alive) throw new UserError('son terminal est fermé : il ne peut pas répondre')
      const cur = this.store.shepherd(id)
      if (cur?.state === 'pending' || cur?.state === 'asked') return this.shepherdState(id)
      const now = Date.now()
      // A fresh-session question already awaits his answer: take it over rather than ask a second one.
      const rec = this.store.renewal(id)
      if (rec?.state === 'asked') this.store.setShepherd(id, { state: 'asked', nextAt: now, askedAt: rec.askedAt, seenAt: rec.askedAt, attempts: 0, note: null })
      else this.store.setShepherd(id, { state: 'pending', nextAt: now, askedAt: 0, seenAt: now, attempts: 0, note: null })
    }
    this.broadcastSession(id)
    return this.shepherdState(id)
  }

  /**
   * One step for a shepherded priest. Never while he works (a turn, or novices running): he is only spoken to
   * once stopped. Asks at `nextAt`, reads his answer, and takes his own "yes" whenever he writes it.
   */
  private async tickShepherd(s: SessionSummary, sh: Shepherd) {
    // Only once he has cleanly ended a turn: never while he works, nor to wake an interrupted or failed one.
    if (s.status !== 'waiting' || (s.external && !s.alive)) return
    const now = Date.now()
    if (sh.state === 'asked') {
      const answer = this.answerSince(s.id, sh.askedAt).trim()
      if (answer) return this.shepherdDecide(s, sh, parseAnswer(answer))
      // No word after a long while (the question got lost): ask again later.
      if (now - sh.askedAt > 3 * 3600_000) this.setShepherd(s.id, { ...sh, state: 'pending', nextAt: now + nextDelay(sh.attempts, null), attempts: sh.attempts + 1 })
      return
    }
    // Before the next question: he may have found his moment himself.
    // Strict: a message opening on OUI with a PASSATION heading of its own (a yes may span several messages).
    const words = this.wordsSince(s.id, sh.seenAt)
    const own = words
      .map((_, i) => parseAnswer(words.slice(i).join('\n\n')))
      .find((a): a is Extract<ShepherdAnswer, { kind: 'yes' }> => a.kind === 'yes' && isHandoff(a.handoff))
    if (own) return this.shepherdDecide(s, sh, own)
    if (now < sh.nextAt) return
    this.setShepherd(s.id, { ...sh, state: 'asked', askedAt: now })
    try {
      await this.reply(s.id, shepherdPrompt(Math.round((s.context ?? 0) / 1000), sh.note))
    } catch (e) {
      // Not delivered: he was not asked; try again a little later.
      this.setShepherd(s.id, { ...sh, state: 'pending', nextAt: now + nextDelay(0, null) })
      throw e
    }
  }

  private async shepherdDecide(s: SessionSummary, sh: Shepherd, a: ShepherdAnswer) {
    const now = Date.now()
    const who = `${s.agent === 'lead' ? 'Le prêtre' : s.agent} « ${s.title} » (${s.project})`
    if (a.kind === 'yes') {
      this.setShepherd(s.id, { ...sh, state: 'done', seenAt: now })
      await this.renew(s, a.handoff)
      this.announce(`☸ ${who} est reparti à neuf, avec sa passation.`)
    } else if (a.kind === 'never') {
      this.setShepherd(s.id, { ...sh, state: 'refused', seenAt: now, note: a.reason.slice(0, 600) })
      this.announce(`☸ ${who} refuse catégoriquement de repartir à neuf : ${a.reason.slice(0, 400)}`)
    } else {
      this.setShepherd(s.id, { ...sh, state: 'pending', seenAt: now, nextAt: now + nextDelay(sh.attempts, a.delayMs), attempts: sh.attempts + 1, note: a.reason })
    }
  }

  private setShepherd(id: string, sh: Shepherd) {
    this.store.setShepherd(id, sh)
    this.broadcastSession(id)
  }

  /** A word from Buddha in his own conversation, for you. */
  private announce(text: string) {
    this.emit(BUDDHA_SESSION_ID, { t: 'buddha.text', text })
  }

  private async readAnswer(s: SessionSummary, askedAt: number) {
    const answer = this.answerSince(s.id, askedAt).trim()
    if (!answer) return // not answered yet
    const first = (answer.split('\n').find((l) => l.trim()) ?? '').toUpperCase().replace(/[^A-ZÀ-Ý ]/g, '').trim()
    const rec = this.store.renewal(s.id)!
    if (!first.startsWith('OUI')) {
      this.store.setRenewal(s.id, { ...rec, state: 'postponed' })
      this.broadcastSession(s.id)
      return
    }
    const handoff = answer.slice(answer.indexOf('\n') + 1).trim() || answer
    await this.renew(s, handoff)
  }

  /** Continue a session in a fresh one: same project, folder, branch and agent, starting from its handoff. */
  private async renew(s: SessionSummary, handoff: string) {
    const old = s.external ? null : this.store.getSession(s.id)
    const row: SessionRow = {
      id: crypto.randomUUID(),
      project: s.project,
      agent: s.agent,
      title: s.title,
      createdAt: Date.now(),
      claudeSessionId: null,
      branch: s.branch,
      worktree: old?.worktree ?? s.cwd,
      // A Sangha worktree passes to the new priest, who will clean it up when dismissed.
      baseSha: old?.baseSha ?? null,
      archivedAt: null,
      lastSeenSeq: 0,
    }
    this.store.createSession(row)
    // The bill follows the work: the fresh session starts from what the old one had cost.
    this.store.setCarriedCost(row.id, this.costOf(s.id) ?? 0)
    if (this.store.silencedIds().has(s.id)) this.store.setSilenced(row.id, true)
    this.store.setRenewal(s.id, { ...(this.store.renewal(s.id) ?? { bucket: 0, askedAt: Date.now() }), state: 'done' })
    // The old one leaves the courtyard: a Sangha priest is closed (his worktree stays for the new one),
    // an outside session is sent away (its terminal is yours to close).
    if (old) {
      this.live.get(old.id)?.close()
      this.live.delete(old.id)
      this.store.archive(old.id)
      for (const fn of this.globalListeners) fn({ kind: 'removed', id: old.id })
    } else {
      // Still open in its terminal, it could pick the same work back up alongside the fresh one: tell it
      // to stop. Only while its terminal runs: reply() would otherwise take the old session over here.
      if (this.observer?.procOf(s.id)) {
        await this.reply(s.id, FAREWELL).catch((e) => console.error('[renewal farewell]', e instanceof Error ? e.message : e))
      }
      this.observer?.hide(s.id, true)
    }
    this.send(
      row.id,
      `Tu reprends un travail en cours, dans une session neuve : la précédente avait un contexte trop lourd. Voici la passation qu'elle a écrite pour toi :\n\n${handoff}\n\nRelis-la, puis continue le travail.`,
    )
  }

  /** Snuff out (or relight) a priest's incense: silenced, he no longer calls for you. */
  silence(id: string, silent: boolean) {
    if (!this.summaryOf(id)) throw new UserError('session inconnue')
    this.store.setSilenced(id, silent)
    this.broadcastSession(id)
  }

  /**
   * Every few seconds: for working sessions whose sentence is missing or stale and whose history moved,
   * ask a small model what they are doing overall. One call at a time.
   */
  startDoingLoop() {
    const every = Number(process.env.SANGHA_DOING_EVERY_S ?? 90) * 1000
    setInterval(() => void this.refreshDoings(every), 10_000)
  }

  private async refreshDoings(every: number) {
    if (this.doingBusy) return
    this.doingBusy = true
    try {
      for (const s of this.summaries()) {
        if (s.status !== 'working' || s.id === BUDDHA_SESSION_ID) continue
        const prev = this.doingOf(s.id)
        const key = this.historyKey(s.id)
        if (prev && (Date.now() - prev.at < every || prev.key === key)) continue
        const lines = recentWindow(this.history(s.id)).flatMap((ev) => {
          if (ev.t === 'user.message') return [`DEMANDE : ${ev.text.slice(0, 1500)}`]
          if (ev.t === 'buddha.text') return [`AGENT : ${ev.text.slice(0, 1500)}`]
          if (ev.t === 'buddha.tool') return [`OUTIL : ${ev.tool} ${ev.summary}`]
          if (ev.t === 'monk.summoned') return [`SOUS-AGENT LANCÉ : ${ev.description}`]
          if (ev.t === 'monk.done') return [`SOUS-AGENT TERMINÉ : ${ev.summary.slice(0, 500)}`]
          return []
        })
        const novices = s.novices.map((n) => `SOUS-AGENT AU TRAVAIL : ${n.description}${n.lastTool ? ` (${n.lastTool.tool} ${n.lastTool.summary})` : ''}`)
        const text = await doing([...lines.slice(-40), ...novices].join('\n')).catch(() => null)
        if (!text) continue
        this.doings.set(s.id, { at: Date.now(), key, text })
        this.store.setNote(s.id, 'doing', key, text)
        const now = this.summaryOf(s.id)
        if (now?.status === 'working') for (const fn of this.globalListeners) fn({ kind: 'session', session: now })
      }
    } finally {
      this.doingBusy = false
    }
  }

  /** Everything a session said, as events: from Sangha's log, or read from an outside transcript. */
  private history(id: string): MonasteryEvent[] {
    if (!id.startsWith(EXTERNAL_PREFIX)) return this.store.events(id).map((e) => e.ev)
    const file = this.observer?.fileOf(id)
    if (!file) return []
    const reader = new TranscriptReader()
    return readTailLines(file, 8 * 1024 * 1024)
      .map(parseLine)
      .filter((l) => l !== null)
      .flatMap((l) => reader.push(l))
  }

  /**
   * Where a session stands on the task it was given, summarized by a small model. Stored: reused as long
   * as the session has not moved on (or for 10 minutes while it works), across reloads and restarts.
   */
  progressOf(id: string): Promise<Progress | null> {
    const summary = this.summaryOf(id)
    const file = id.startsWith(EXTERNAL_PREFIX) ? this.observer?.fileOf(id) : null
    // The state described: when an outside transcript last moved, or the last time a Sangha priest stopped.
    const key = file ? String(statSync(file).mtimeMs) : `idle:${this.store.lastIdleSeq(id)}`
    const stored = this.store.note<Progress>(id, 'progress')
    if (stored && (stored.key === key || (summary?.status === 'working' && Date.now() - stored.at < 10 * 60_000))) return Promise.resolve(stored.value)
    const inflight = this.progressCache.get(id)
    if (inflight?.key === key) return inflight.value
    const events = this.history(id)
    const first = events.find((e) => e.t === 'user.message')
    const lines = events.flatMap((ev) => {
      if (ev.t === 'user.message') return [`UTILISATEUR : ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'buddha.text') return [`AGENT : ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'monk.summoned') return [`SOUS-AGENT LANCÉ (${ev.agentType}) : ${ev.description}`]
      if (ev.t === 'monk.done') return [`SOUS-AGENT TERMINÉ : ${ev.summary.slice(0, 800)}`]
      if (ev.t === 'error') return [`ERREUR : ${ev.message}`]
      return []
    })
    const input = [
      first && first.t === 'user.message' ? `DEMANDE INITIALE : ${first.text.slice(0, 3000)}` : '',
      summary ? `ÉTAT ACTUEL : ${summary.status}${summary.novices.length ? `, ${summary.novices.length} sous-agent(s) au travail` : ''}` : '',
      '--- FIL (le plus récent en dernier) ---',
      lines.join('\n\n').slice(-10_000),
    ].join('\n\n')
    const value = lines.length
      ? progress(input)
          .then((p) => {
            if (p) this.store.setNote(id, 'progress', key, p)
            return p
          })
          .catch(() => stored?.value ?? null)
      : Promise.resolve(null)
    this.progressCache.set(id, { key, value })
    void value.finally(() => this.progressCache.delete(id))
    return value
  }

  /** Last words of a priest, for Buddha's reports. */
  lastWords(id: string, n = 3): string[] {
    if (id.startsWith(EXTERNAL_PREFIX)) {
      const file = this.observer?.fileOf(id)
      if (!file) return []
      const reader = new TranscriptReader()
      return readTailLines(file, 512 * 1024)
        .map(parseLine)
        .filter((l) => l !== null)
        .flatMap((l) => reader.push(l))
        .filter((e) => e.t === 'buddha.text')
        .slice(-n)
        .map((e) => (e.t === 'buddha.text' ? e.text : ''))
    }
    return this.store
      .events(id)
      .filter((e) => e.ev.t === 'buddha.text' || e.ev.t === 'error')
      .slice(-n)
      .map((e) => (e.ev.t === 'buddha.text' ? e.ev.text : e.ev.t === 'error' ? `ERROR: ${e.ev.message}` : ''))
  }

  subscribe(id: string, fn: Listener): () => void {
    let set = this.listeners.get(id)
    if (!set) this.listeners.set(id, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  subscribeAll(fn: GlobalListener): () => void {
    this.globalListeners.add(fn)
    return () => this.globalListeners.delete(fn)
  }

  closeAll() {
    for (const s of this.live.values()) s.close()
  }

  private summary(row: SessionRow): SessionSummary {
    const live = this.live.get(row.id)
    let status: SessionStatus
    if (live?.busy) status = 'working'
    else if (!live && this.store.lastEvent(row.id, 'busy')?.ev.busy) status = 'interrupted'
    else {
      const err = this.store.lastEvent(row.id, 'error')
      const user = this.store.lastEvent(row.id, 'user.message')
      if (err && (!user || err.seq > user.seq)) status = 'error'
      // Stopped: he waits for your input, seen or not.
      else status = this.store.lastIdleSeq(row.id) > 0 ? 'waiting' : 'idle'
    }
    return {
      id: row.id,
      project: row.project,
      agent: row.agent,
      title: row.title,
      createdAt: row.createdAt,
      claudeSessionId: row.claudeSessionId,
      branch: row.branch,
      status,
      activity: live?.activity ?? null,
      doing: live?.busy ? (this.doingOf(row.id)?.text ?? null) : null,
      novices: live ? [...live.novices.values()] : [],
      recap: status === 'working' ? null : this.currentRecap(row.id),
      external: false,
      alive: false,
      silenced: this.store.silencedIds().has(row.id),
      context: row.id === BUDDHA_SESSION_ID ? null : this.contextOf(row),
      renewal: this.renewalState(row.id),
      shepherd: this.shepherdState(row.id),
      cost: this.costOf(row.id),
      cwd: row.id === BUDDHA_SESSION_ID ? null : (row.worktree ?? (this.projects.exists(row.project) ? this.projects.dir(row.project) : null)),
    }
  }

  private currentRecap(id: string): { done: string; next: string } | null {
    const r = this.store.lastEvent(id, 'recap')
    const user = this.store.lastEvent(id, 'user.message')
    return r && (!user || r.seq > user.seq) ? { done: r.ev.done, next: r.ev.next } : null
  }

  private ensureLive(row: SessionRow): LiveSession {
    let s = this.live.get(row.id)
    if (!s) {
      const isBuddha = row.id === BUDDHA_SESSION_ID
      const cwd = isBuddha ? config.workspacesDir : (row.worktree ?? this.projects.dir(row.project))
      s = new LiveSession(
        row,
        cwd,
        isBuddha ? this.buddhaOptions(this) : priestOptions(row.agent),
        (ev) => this.emit(row.id, ev),
        () => {
          this.live.delete(row.id)
          this.broadcastSession(row.id)
        },
        (claudeId) => this.store.setClaudeSessionId(row.id, claudeId),
      )
      this.live.set(row.id, s)
    }
    return s
  }

  private emit(id: string, ev: MonasteryEvent) {
    const env = this.store.append(id, ev)
    for (const fn of this.listeners.get(id) ?? []) fn(env)
    if (ev.t === 'quota') {
      this.quota = ev.quota
      for (const fn of this.globalListeners) fn({ kind: 'quota', quota: ev.quota })
    }
    if (SUMMARY_EVENTS.has(ev.t)) this.broadcastSession(id)
    if (ev.t === 'busy' && !ev.busy && id !== BUDDHA_SESSION_ID) void this.writeRecap(id, env.seq)
  }

  /** When a priest stops, a small model writes what he did and what is left. Dropped if he resumed meanwhile. */
  private async writeRecap(id: string, idleSeq: number) {
    const events = this.store.events(id).map((e) => e.ev)
    const lines = recentWindow(events).flatMap((ev) => {
      if (ev.t === 'user.message') return [`UTILISATEUR : ${ev.text.slice(0, 1500)}`]
      if (ev.t === 'buddha.text') return [`AGENT : ${ev.text}`]
      if (ev.t === 'buddha.tool') return [`OUTIL : ${ev.tool} ${ev.summary}`]
      if (ev.t === 'monk.done') return [`SOUS-AGENT (${ev.status}) : ${ev.summary.slice(0, 1500)}`]
      if (ev.t === 'error') return [`ERREUR : ${ev.message}`]
      return []
    })
    const lastUser = events.findLastIndex((e) => e.t === 'user.message')
    if (!events.slice(lastUser + 1).some((e) => e.t === 'buddha.text' || e.t === 'error')) return
    try {
      const r = await recap(lines.join('\n\n'))
      const stillIdle = !this.live.get(id)?.busy && this.store.lastIdleSeq(id) === idleSeq
      if (r && stillIdle && this.store.getSession(id)?.archivedAt == null) this.emit(id, { t: 'recap', ...r })
    } catch (err) {
      console.error(`[recap ${id.slice(0, 8)}]`, err instanceof Error ? err.message : err)
    }
  }

  private broadcastSession(id: string) {
    const session = this.summaryOf(id)
    if (session) for (const fn of this.globalListeners) fn({ kind: 'session', session })
  }
}

/**
 * The latest exchanges, from the user's third-to-last message on: a short "reprends" or "ok" alone says
 * nothing of the task, the words before it do.
 */
export function recentWindow(events: MonasteryEvent[], asks = 3): MonasteryEvent[] {
  let from = events.length
  for (let n = 0; n < asks && from > 0; ) if (events[--from]!.t === 'user.message') n++
  return events.slice(from)
}

/** An error caused by the request, reported to the client as a 400. */
export class UserError extends Error {}
