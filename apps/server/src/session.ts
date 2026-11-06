import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { query, type HookCallback, type McpServerConfig, type McpServerStatus, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { GitIdentitySetting } from './gitIdentity'
import { reserveMessage, reserveState, type QuotaReserveSetting } from './quotaReserve'
import { checkSessionEnv } from './sessionEnv'
import {
  BUDDHA_SESSION_ID,
  type AutonomyState,
  type BackgroundScript,
  type CostReport,
  type Envelope,
  type GlobalEvent,
  type GlobalMcp,
  type McpServer,
  type MonasteryEvent,
  type NirvanaEntry,
  type NirvanaSearchResult,
  type NoviceSummary,
  type Quota,
  type QuotaReserve,
  type QuotaReserveState,
  type SessionRecap,
  type SessionStatus,
  type SessionSummary,
} from '@sangha/shared'
import { config } from './config'
import type { HostNirvanaWorktree } from './host'
import { Providers } from './providers'
import { LOOP_STOP_MESSAGE, type SessionRow, type Shepherd, type Store } from './db'
import { addWorktree, isGitRepo, removeWorktree, restoreWorktree, worktreeState, type WorktreeState } from './git'
import { EXTERNAL_PREFIX, type Observer } from './observer'
import { transcriptPath, type Projects } from './projects'
import { library } from './library'
import { startRemote, type RemoteControl } from './remote'
import { enabledExtras, mcpList, nativeMcp, mcpLogin, mcpReady, mcpSettle, readCatalog, type Catalog } from './mcp'
import { readTailLines } from './files'
import { Normalizer } from './normalize'
import { relayToPeer } from './messenger'
import { PullRequests } from './pulls'
import { BusySettle } from './settle'
import { carriedOnIn } from './chain'
import { doing, lifeSummary, nirvanaSearch, progress, recap, scriptSummary, type NirvanaSearchEntry, type Progress } from './recap'
import { priestOptions } from './roles'
import { ScriptSummaries, trackScripts } from './scripts'
import { contextTokens, parseLine, TranscriptReader } from './transcript'
import { buildCostReport, CostMeter } from './cost'
import { isHandoff, nextDelay, parseAnswer, readDecision, renewalMessage, shepherdPrompt, writeHandoffContext, type ShepherdAnswer } from './shepherd'
import { withTimeout } from './timeout'

/** A search through the nirvana must answer in a reasonable time, or hold its priest for nothing. */
const NIRVANA_SEARCH_TIMEOUT_MS = 60_000

type Listener = (env: Envelope) => void
type GlobalListener = (ev: GlobalEvent) => void

/** Now, in epoch seconds (quota windows' `resetsAt` is seconds, everything else here is ms). */
const nowSec = () => Math.floor(Date.now() / 1000)

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
const SUMMARY_EVENTS = new Set<MonasteryEvent['t']>(['busy', 'background', 'monk.summoned', 'monk.tool', 'monk.done', 'buddha.tool', 'loop.wake', 'turn.done', 'error', 'user.message', 'recap'])

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
  private markClosed!: () => void
  /** Resolves once his process is gone (and he left the live map). */
  readonly closed = new Promise<void>((r) => (this.markClosed = r))
  // Said to have stopped only after a few still seconds: a background task reporting back wakes him right after his turn.
  private settle = new BusySettle(config.settleMs, (busy) => this.emit({ t: 'busy', busy }))
  get busy() {
    return this.settle.busy
  }
  /** A turn runs: a message sent now would only be read once it ends. */
  get turning() {
    return this.turnRunning
  }
  activity: string | null = null
  novices = new Map<string, NoviceSummary>()
  /** Background work the turn left running (a script, a novice): he waits on it, so he is still at work. */
  private background: { id: string; type: string; description: string }[] = []
  /** Scripts among that background work (novices excepted), each with its Haiku summary once written. */
  scripts: BackgroundScript[] = []
  private requestedSummaries = new Set<string>()

  constructor(
    row: SessionRow,
    cwd: string,
    options: Partial<Options>,
    private emit: (ev: MonasteryEvent) => void,
    private onClosed: () => void,
    onClaudeSessionId: (id: string) => void,
    private requestScriptSummary: (taskId: string, command: string) => void,
    /** Whether his session currently has an active `/loop`: its CronCreate jobs and ScheduleWakeup live
     * only inside this process, so it must never be idle-closed (see `refreshBusy`) while one is active. */
    private isLoopActive: () => boolean,
    mcpToggles: Record<string, boolean> = {},
  ) {
    // Claude by default; a provider's session gets its own environment through `options.env`.
    const env = { ...process.env } as Record<string, string>
    delete env.ANTHROPIC_API_KEY // belt and braces: never bill the API
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd,
        plugins: localPlugins(),
        // Yours too (~/.claude): your skills, your CLAUDE.md, your agents and settings, as in a terminal.
        settingSources: ['user', 'project'],
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
    // A worktree is a new folder for Claude: the servers you switched for this project must be switched again.
    for (const [name, enabled] of Object.entries(mcpToggles)) void this.q.toggleMcpServer(name, enabled).catch(() => undefined)
  }

  mcpStatus(): Promise<McpServerStatus[]> {
    return this.q.mcpServerStatus()
  }

  toggleMcp(name: string, enabled: boolean): Promise<void> {
    return this.q.toggleMcpServer(name, enabled)
  }

  /** Switches his model for his next replies, without restarting him (same engine only). */
  setModel(model: string | undefined): Promise<void> {
    return this.q.setModel(model)
  }

  reconnectMcp(name: string): Promise<void> {
    return this.q.reconnectMcpServer(name)
  }

  /** The servers Sangha adds from your Claude config; resolves once they connected (or failed to). */
  async setExtraMcp(servers: Record<string, McpServerConfig>): Promise<void> {
    await this.q.setMcpServers(servers)
  }

  send(text: string) {
    this.turnRunning = true
    this.refreshBusy()
    this.inbox.push(text)
  }

  /**
   * Stops his current turn and every background task he left running (a script, a novice): Sangha never
   * declares `perTaskStopAffordance` (see sdk.d.ts), so nothing of ours renders a per-task stop control —
   * only an explicit `stopTask` per id makes "interrupt" mean "stop everything" rather than "pause the
   * reply while a runaway Bash or subagent keeps going". A novice's monkId (his summoning tool_use id) is
   * not the id `stopTask` wants: `taskIdOfMonk` resolves it to his own SDK task id. Each stop is tried
   * independently: one already gone (settled right as you interrupted) must not stop the others.
   */
  async interrupt() {
    await this.q.interrupt().catch(() => undefined)
    const taskIds = [...this.background.map((t) => t.id), ...[...this.novices.keys()].map((id) => this.normalizer.taskIdOfMonk(id))].filter((id): id is string => !!id)
    await Promise.all(taskIds.map((id) => this.q.stopTask(id).catch(() => undefined)))
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
        this.scripts = trackScripts(this.scripts, ev.tasks, Date.now())
        for (const s of this.scripts) {
          if (s.summary === null && !this.requestedSummaries.has(s.id)) {
            this.requestedSummaries.add(s.id)
            this.requestScriptSummary(s.id, s.command)
          }
        }
        if (!this.turnRunning) this.activity = this.waitingOn()
        break
    }
  }

  /** Once a small model has written a script's summary. */
  setScriptSummary(taskId: string, summary: string) {
    this.scripts = this.scripts.map((s) => (s.id === taskId ? { ...s, summary } : s))
    if (!this.turnRunning) this.activity = this.waitingOn()
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
      this.scripts = []
      this.requestedSummaries.clear()
      this.activity = null
      this.refreshBusy(true) // closed: nothing will wake him, no need to wait
      this.onClosed()
      this.markClosed()
    }
  }

  /** What he waits on once his turn is over: the oldest script still running, if any (its Haiku summary once written). */
  private waitingOn() {
    const t = this.scripts[0]
    return t ? `En attente · ${t.summary ?? t.command}` : null
  }

  private refreshBusy(now = false) {
    const busy = this.turnRunning || this.novices.size > 0 || this.background.length > 0
    this.settle.set(busy, { now })
    clearTimeout(this.idleTimer)
    // An active `/loop`'s CronCreate jobs and ScheduleWakeup live only in this process: idle-closing it
    // while still would kill a loop pacing itself slower than `idleCloseMs`, with nothing left to wake him.
    if (!busy && !this.isLoopActive()) this.idleTimer = setTimeout(() => this.close(), config.idleCloseMs)
  }
}

/** `model`: an id of `models()` ('' or absent: the agent's own). */
export type CreateSession = { project: string; agent: string; prompt: string; baseRef?: string; model?: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

/** Sent to an outside session once its work has moved on to a fresh session. */
export const FAREWELL =
  'La suite de ton travail continue dans une session neuve, qui a reçu ta passation. Arrête ici tout travail : ne lance ni ne relance plus de sous-agents, et ne réponds plus aux notifications de tâches. Tu peux être fermée.'

export const RESTARTED =
  'Ta session vient d’être relancée depuis Sangha : ton fichier d’agent, tes outils, skills et serveurs MCP ont été relus. Vérifie que ce qui te manquait est là, puis reprends où tu en étais (si tu attendais une réponse de ma part, attends-la).'

export class Sessions {
  private live = new Map<string, LiveSession>()
  /** MCP servers met in a priest, for the list of all of Sangha (native: he loads it himself, so on by default). */
  private seenMcp = new Map<string, { scope: string; native: boolean }>()
  private remotes = new Map<string, RemoteControl>()
  /** A `remoteControl` asked for while he still worked: fires by itself once he actually settles (see `emit`'s 'busy' hook). */
  private remotePending = new Set<string>()
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
  /** Whether the quota reserve bites right now, and which window does (see `quotaReserve.ts`). */
  reserve: QuotaReserveState
  // Fires at the binding window's resetsAt (+ a few seconds): no quota event arrives while priests stay idle.
  private reserveTimer: NodeJS.Timeout | null = null
  /** Endpoints other than Claude a priest can think with, and the models they offer. */
  readonly providers: Providers
  // Pull requests of each session's folder, cached and refreshed in the background (see startPullsLoop).
  private pulls = new PullRequests((cwd) => this.pullsChanged(cwd))
  // Haiku summaries of background scripts, one call at a time across every live session (see LiveSession.scripts).
  private scriptSummaries = new ScriptSummaries((sessionId, taskId, summary) => {
    this.live.get(sessionId)?.setScriptSummary(taskId, summary)
    this.broadcastSession(sessionId)
  }, scriptSummary)

  constructor(
    private store: Store,
    private projects: Projects,
    private buddhaOptions: (sessions: Sessions) => Partial<Options>,
    private quotaReserveSetting: QuotaReserveSetting,
    private git?: GitIdentitySetting,
  ) {
    this.providers = new Providers(store)
    this.quota = store.latestQuota()
    this.reserve = reserveState(this.quotaReserveSetting.get(), this.quota, nowSec())
    this.scheduleReserveTimer()
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

  async create({ project, agent, prompt, baseRef, model = '' }: CreateSession): Promise<SessionSummary> {
    if (!this.projects.exists(project)) throw new UserError(`projet inconnu : ${project}`)
    const choice = await this.providers.choice(model)
    if (!choice) throw new UserError(`modèle indisponible : ${model}`)
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
      engine: choice.engine,
      model: choice.model,
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

  /** Called by the observer when an outside session's folder stops working (it may just have run `gh pr create`). */
  externalStoppedWorking(cwd: string) {
    setTimeout(() => this.pulls.soon(cwd), 5_000)
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
      // Queuing is Sangha's own priests' business; an outside session has no such queue, so he is simply refused.
      if (this.blocked()) throw new UserError(reserveMessage(this.reserve, this.quota))
      const r = await relayToPeer({ cwd: proc.cwd, startedAt: s.createdAt }, this.withReminder(id, text))
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
    // Driven from claude.ai: takes him back rather than queueing forever — stopping it fires its own
    // `onExit` (below), which flushes whatever ends up queued once it has actually ended.
    if (this.remotes.has(id)) this.stopRemote(id)
    // In a turn, held by the quota reserve, or (still, right now) the remote: the message waits, editable.
    if (this.reserve.reached || this.live.get(id)?.turning || this.remotes.has(id)) {
      this.store.addQueued(id, { id: crypto.randomUUID(), text, at: Date.now() })
      this.broadcastSession(id)
      return
    }
    this.deliver(row, text)
  }

  private deliver(row: SessionRow, text: string) {
    this.emit(row.id, { t: 'user.message', text })
    this.ensureLive(row).send(this.withReminder(row.id, text))
  }

  /** His turn ended (or his process did): what you wrote meanwhile leaves, as one message. Held while the reserve bites. */
  private flushQueued(id: string) {
    const row = this.store.getSession(id)
    if (!row || row.archivedAt || this.reserve.reached || this.live.get(id)?.turning) return
    if (!this.store.queued(id).length) return
    // Takes him back rather than leaving it queued forever: stopping the remote re-runs this very function
    // from its own `onExit`, once it has actually ended.
    if (this.remotes.has(id)) return this.stopRemote(id)
    const queued = this.store.takeQueued(id)
    this.deliver(row, queued.map((m) => m.text).join('\n\n'))
  }

  editQueued(id: string, messageId: string, text: string) {
    if (!text.trim()) throw new UserError('message vide')
    if (!this.store.editQueued(id, messageId, text.trim())) throw new UserError('déjà parti : il l’a reçu')
    this.broadcastSession(id)
  }

  withdrawQueued(id: string, messageId: string) {
    if (!this.store.takeQueued(id, [messageId]).length) throw new UserError('déjà parti : il l’a reçu')
    this.broadcastSession(id)
  }

  /** Sends a waiting message right away: he reads it in the middle of his turn. Refused while the reserve bites. */
  sendQueuedNow(id: string, messageId: string) {
    if (this.reserve.reached) throw new UserError(reserveMessage(this.reserve, this.quota))
    const row = this.store.getSession(id)
    const [m] = this.store.takeQueued(id, [messageId])
    if (!row || !m) throw new UserError('déjà parti : il l’a reçu')
    this.deliver(row, m.text)
  }

  /**
   * Hands his conversation to an interactive `claude --remote-control`, to drive from claude.ai or the phone.
   * Never two processes on one conversation: his own stops first, and nothing restarts it until the remote ends.
   * Nothing of his is ever cut: while he still works, the hand-off is only recorded (`remotePending`, see
   * `summary`) and fires by itself once he actually settles (`emit`'s 'busy' hook calls `fireRemotePending`).
   * A second request while pending is a no-op; `stopRemote` cancels it.
   */
  async remoteControl(id: string): Promise<{ url: string } | { pending: true }> {
    const running = this.remotes.get(id)
    if (running) return { url: running.url }
    if (this.remotePending.has(id)) return { pending: true }
    const row = this.priestRow(id)
    if (!row.claudeSessionId) throw new UserError('pas encore de conversation à reprendre')
    const old = this.live.get(id)
    // `busy` (not just `turning`): a turn just resumed and already ended counts too, through BusySettle's
    // short grace period — he may still be about to reschedule a loop or otherwise act right after it.
    if (old?.busy) {
      this.remotePending.add(id)
      this.broadcastSession(id)
      return { pending: true }
    }
    return this.startRemoteNow(id, row)
  }

  /**
   * Actually stops his process and starts `claude --remote-control` on the same conversation: today's
   * immediate path when he is idle, and what a pending hand-off runs once he settles (`fireRemotePending`).
   */
  private async startRemoteNow(id: string, row: SessionRow): Promise<{ url: string }> {
    const old = this.live.get(id)
    if (old) {
      old.close()
      await Promise.race([old.closed, new Promise((r) => setTimeout(r, 15_000))])
      if (this.live.get(id) === old) this.live.delete(id)
    }
    const cwd = this.cwdOf(row) ?? config.workspacesDir
    const env = this.withGit({}, id).env as Record<string, string>
    try {
      const rc = await startRemote(cwd, row.claudeSessionId!, row.title, env, () => {
        this.remotes.delete(id)
        this.broadcastSession(id)
        this.flushQueued(id)
      })
      this.remotes.set(id, rc)
      this.broadcastSession(id)
      return { url: rc.url }
    } catch (e) {
      throw new UserError(`Remote Control impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** A pending hand-off's wait is over (`emit`'s 'busy' hook, right as he settles): starts the remote now,
   * exactly as an immediate request would. Logged rather than retried, should starting it fail. */
  private async fireRemotePending(id: string) {
    this.remotePending.delete(id)
    const row = this.store.getSession(id)
    if (row && !row.archivedAt) {
      try {
        await this.startRemoteNow(id, row)
      } catch (e) {
        console.error(`[remote-control ${id.slice(0, 8)}]`, e instanceof Error ? e.message : e)
      }
    }
    this.broadcastSession(id)
  }

  /** Ends the remote: Sangha takes his conversation back with the next message (queued ones leave now).
   * While a hand-off only waits for him to settle (never started), this cancels it instead. */
  stopRemote(id: string) {
    if (this.remotePending.delete(id)) return this.broadcastSession(id)
    this.remotes.get(id)?.stop()
  }

  /**
   * Takes him back from an active Remote Control before anything of ours calls `ensureLive`: never two
   * processes on one conversation, so this stops it and actually waits for it to end (its own `onExit`
   * already clears `this.remotes`) rather than just asking and hoping. A no-op when no remote is active.
   */
  private async takeBackFromRemote(id: string): Promise<void> {
    const rc = this.remotes.get(id)
    if (!rc) return
    rc.stop()
    await Promise.race([rc.closed, new Promise((r) => setTimeout(r, 15_000))])
  }

  /** Relaunch a session the server stopped mid-work. */
  resume(id: string) {
    this.send(id, 'The Sangha server restarted while you were working. Check where you stopped, then continue.')
  }

  /**
   * Really stop him: his current turn, and the background work he was still waiting on (scripts, novices) —
   * none of that stays alive to keep him "working" after you pressed Interrompre. If an autonomy (`/goal`
   * or `/loop`) was still active, it is stopped too: left alone, a goal would relaunch him turn after turn
   * right past the interruption, and a loop would just wake itself up again (his text stays in the summary,
   * inactive, so you can relaunch the same one on purpose).
   */
  async interrupt(id: string) {
    await this.live.get(id)?.interrupt()
    if (id === BUDDHA_SESSION_ID || id.startsWith(EXTERNAL_PREFIX)) return // Buddha has none; an outside session's lives in its own terminal
    const current = this.store.lastAutonomy(id)
    if (current?.active) await this.stopAutonomy(id, current.mode)
  }

  /** Sends `/goal clear` or a loop's stop text straight to him. Whether his turn needs interrupting first
   * (a loop, left alone, would just schedule its next wake-up) is for the caller to decide. Takes him back
   * first if a remote currently holds him, rather than refusing. */
  private async stopAutonomy(id: string, mode: 'goal' | 'loop') {
    const row = this.priestRow(id)
    await this.takeBackFromRemote(id)
    const cmd = mode === 'goal' ? '/goal clear' : LOOP_STOP_MESSAGE
    this.emit(id, { t: 'user.message', text: cmd })
    this.ensureLive(row).send(cmd)
  }

  /**
   * His autonomy: Claude Code `/goal` or `/loop`, never both at once (see `Store.lastAutonomy`). Sent as a
   * bare slash command (or Sangha's own stop text for a loop) — never through `withReminder`, which would
   * append your standing instruction and break the command — and right away rather than through the usual
   * turn-end queue: steering him is not a message to discuss, so it should reach him now, mid-turn or not.
   *
   * Starting one mode first stops whichever ran under the other, so the two are never both active: a
   * `/goal clear` ahead of a `/loop`, or the loop's stop text ahead of a `/goal`. `patch` null stops
   * whatever is active outright: for a loop that also means interrupting his current turn first — nothing
   * else is about to tell him to stop rescheduling himself.
   */
  async autonomy(id: string, patch: { mode: 'goal' | 'loop'; text: string; interval?: string | null } | null) {
    const row = this.priestRow(id)
    // Takes him back from a remote rather than refusing — `ensureLive` below would otherwise throw.
    await this.takeBackFromRemote(id)
    const current = this.store.lastAutonomy(id)

    if (!patch) {
      if (!current) return
      if (current.mode === 'loop') await this.live.get(id)?.interrupt()
      await this.stopAutonomy(id, current.mode)
      return
    }

    if (current && current.mode !== patch.mode) await this.stopAutonomy(id, current.mode)

    const text = patch.text.trim()
    const interval = patch.mode === 'loop' ? patch.interval?.trim() : null
    const cmd = patch.mode === 'goal' ? `/goal ${text}` : `/loop ${interval ? `${interval} ` : ''}${text}`
    // `ensureLive` before `emit`: if his process is dead and this is what starts a fresh one, `lastAutonomy`
    // must still reflect the *previous* state when the fresh process decides whether to re-arm a loop —
    // this command is about to supersede it anyway, never the one it needs re-sent to it.
    const live = this.ensureLive(row)
    this.emit(id, { t: 'user.message', text: cmd })
    live.send(cmd)
  }

  // ——— Quota reserve: holding every priest once the plan quota approaches the share you asked to keep untouched ———

  /** Whether the reserve holds every priest right now: the single check every quota-consuming entry point makes. */
  blocked(): boolean {
    return this.reserve.reached
  }

  /** Your change to the reserve: validated, persisted, and re-evaluated right away. */
  setReserve(patch: Partial<QuotaReserve>): QuotaReserveState {
    try {
      this.quotaReserveSetting.set(patch)
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e))
    }
    this.reevaluateReserve()
    return this.reserve
  }

  /** Re-checks the reserve against the latest setting and quota; reacts and broadcasts on any change. */
  private reevaluateReserve() {
    const next = reserveState(this.quotaReserveSetting.get(), this.quota, nowSec())
    const wasReached = this.reserve.reached
    const changed = next.reached !== this.reserve.reached || next.window !== this.reserve.window || next.enabled !== this.reserve.enabled || next.pct !== this.reserve.pct
    this.reserve = next
    if (changed) for (const fn of this.globalListeners) fn({ kind: 'reserve', reserve: next })
    if (next.reached && !wasReached) this.onReserveReached()
    else if (!next.reached && wasReached) this.onReserveReleased()
    this.scheduleReserveTimer()
  }

  /** The transition into the reserve: every busy priest is interrupted once, with a clear word in his own session. */
  private onReserveReached() {
    const message = reserveMessage(this.reserve, this.quota)
    for (const [id, live] of this.live) {
      if (!live.busy) continue
      void live.interrupt()
      this.emit(id, { t: 'error', message })
    }
  }

  /** Leaving the reserve: your messages held meanwhile (queued by `send`, or stuck in `flushQueued`) finally go out. */
  private onReserveReleased() {
    for (const row of this.store.listSessions()) this.flushQueued(row.id)
  }

  /** No quota event arrives while priests stay idle: a timer re-checks right after the binding window should reset. */
  private scheduleReserveTimer() {
    if (this.reserveTimer) clearTimeout(this.reserveTimer)
    this.reserveTimer = null
    const resetsAt = this.reserve.window ? (this.quota?.[this.reserve.window]?.resetsAt ?? null) : null
    if (!resetsAt) return
    const ms = resetsAt * 1000 - Date.now() + 5_000
    if (ms > 0) this.reserveTimer = setTimeout(() => this.reevaluateReserve(), ms)
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
    // Kept while another session still works there (the one he renewed into, or that renewed into him).
    if (row.worktree && row.branch && row.baseSha && !this.store.othersInWorktree(row.worktree, id).length) await removeWorktree(this.projects.dir(row.project), row.worktree, row.branch, state.ahead)
    this.store.archive(id)
    for (const fn of this.globalListeners) fn({ kind: 'removed', id })
    for (const fn of this.globalListeners) fn({ kind: 'nirvana' })
    void this.generateNirvanaSummary(this.store.getSession(id)!)
    return { ok: true }
  }

  /**
   * Bring a priest back from nirvana: his folder returns (at the same path, so Claude Code finds his
   * transcript again), then he un-archives. He is not woken: the next message resumes him as usual.
   */
  async reincarnate(id: string): Promise<SessionSummary> {
    const row = this.store.getSession(id)
    if (!row || !row.archivedAt || id === BUDDHA_SESSION_ID) throw new UserError('session inconnue')
    if (!this.projects.exists(row.project)) throw new UserError(`projet disparu : ${row.project}`)
    if (row.worktree && !existsSync(row.worktree)) {
      if (row.baseSha) await restoreWorktree(this.projects.dir(row.project), row.worktree, row.branch!, row.baseSha)
      else throw new UserError('son dossier a disparu')
    }
    this.store.unarchive(id)
    this.broadcastSession(id)
    for (const fn of this.globalListeners) fn({ kind: 'nirvana' })
    return this.summaryOf(id)!
  }

  /** Sessions sent to nirvana (dismissed), newest first. Queues Haiku summaries missing for the oldest of them. */
  nirvana(): NirvanaEntry[] {
    const rows = this.store.archivedSessions().filter((r) => r.id !== BUDDHA_SESSION_ID)
    const missing = rows.filter((r) => !this.hasNirvanaSummary(r)).slice(0, 20)
    if (missing.length) void this.fillNirvanaSummaries(missing)
    return rows.map((r) => this.nirvanaEntry(r))
  }

  /**
   * Which past (nirvana) sessions best answer a question of yours, a small model's best guess (never
   * the exact words of a search box): refused while empty, or while the quota reserve holds every
   * priest, same as a recap would be. Times out rather than holding you forever.
   */
  async searchNirvana(q: string): Promise<NirvanaSearchResult> {
    if (!q.trim()) throw new UserError('Question vide.')
    if (this.blocked()) throw new UserError(reserveMessage(this.reserve, this.quota))
    const notes = this.store.notes()
    const entries: NirvanaSearchEntry[] = this.store
      .archivedSessions()
      .filter((r) => r.id !== BUDDHA_SESSION_ID)
      .map((r) => ({
        id: r.id,
        date: new Date(r.archivedAt!).toISOString().slice(0, 10),
        project: r.project,
        branch: r.branch,
        agent: r.agent,
        note: notes.get(r.id) ?? null,
        title: r.title,
        summary: this.nirvanaSummaryOf(r),
      }))
    return withTimeout(nirvanaSearch(entries, q.trim()), NIRVANA_SEARCH_TIMEOUT_MS, () => new UserError('La recherche a pris trop de temps : réessaie.'))
  }

  /**
   * What the monastery has cost at API prices since monitoring began: every session's own transcript
   * cost (never a predecessor's carried-over cost, or it would be counted twice), archived sessions
   * included. Buddha counts too, under project "Bouddha" — his transcript sits under his fixed cwd.
   */
  costReport(): CostReport {
    const sessions = this.store
      .allSessions()
      .map((row) => {
        const file = this.reportTranscriptOf(row)
        if (row.id === BUDDHA_SESSION_ID && !file) return null // not computable: skip him
        return {
          id: row.id,
          project: row.id === BUDDHA_SESSION_ID ? 'Bouddha' : row.project,
          title: row.title,
          createdAt: row.createdAt,
          cost: file ? this.meter.session(file) : 0,
        }
      })
      .filter((s) => s !== null)
    return buildCostReport(sessions)
  }

  /** Transcript for the cost report: same rule as `transcriptOf`, but Buddha's cwd is fixed (his worktree is not project-bound). */
  private reportTranscriptOf(row: SessionRow): string | null {
    if (!row.claudeSessionId) return null
    const cwd = row.id === BUDDHA_SESSION_ID ? config.workspacesDir : (row.worktree ?? (this.projects.exists(row.project) ? this.projects.dir(row.project) : null))
    if (!cwd) return null
    const file = transcriptPath(cwd, row.claudeSessionId)
    return existsSync(file) ? file : null
  }

  private hasNirvanaSummary(row: SessionRow): boolean {
    return this.nirvanaSummaryOf(row) !== null
  }

  /** The whole-life summary a small model wrote when he was sent to nirvana, null until it is (see `generateNirvanaSummary`). */
  private nirvanaSummaryOf(row: SessionRow): string | null {
    const note = this.store.note<{ summary: string }>(row.id, 'nirvana')
    return note && note.key === String(row.archivedAt) ? note.value.summary : null
  }

  private nirvanaEntry(row: SessionRow): NirvanaEntry {
    const renewal = this.store.renewal(row.id)
    return {
      id: row.id,
      project: row.project,
      agent: row.agent,
      title: row.title,
      branch: row.branch,
      createdAt: row.createdAt,
      archivedAt: row.archivedAt!,
      cost: this.costOf(row.id),
      summary: this.nirvanaSummaryOf(row),
      note: this.store.notes().get(row.id) ?? null,
      renewed: renewal?.state === 'done',
      continuedIn: renewal?.state === 'done' ? carriedOnIn(this.store, row.id) : null,
    }
  }

  /** Archived sessions that had a worktree, so an orphan one can be named after who left it behind, or own a sub-agent of theirs (see `host.ts`). */
  archivedWorktrees(): HostNirvanaWorktree[] {
    const notes = this.store.notes()
    return this.store
      .archivedSessions()
      .filter((r) => r.worktree)
      .map((r) => ({ id: r.id, path: r.worktree!, title: r.title, note: notes.get(r.id) ?? null, archivedAt: r.archivedAt! }))
  }

  private nirvanaBusy = false

  /** One Haiku call at a time, so old history fills in progressively rather than all at once. */
  private async fillNirvanaSummaries(rows: SessionRow[]) {
    if (this.nirvanaBusy) return
    this.nirvanaBusy = true
    try {
      for (const row of rows) await this.generateNirvanaSummary(row)
    } finally {
      this.nirvanaBusy = false
    }
  }

  /** What the whole session was about, written by a small model once he is sent to nirvana. */
  private async generateNirvanaSummary(row: SessionRow) {
    try {
      const summary = await lifeSummary(this.lifeTranscript(row.id))
      if (!summary) return
      this.store.setNote(row.id, 'nirvana', String(row.archivedAt), { summary })
      for (const fn of this.globalListeners) fn({ kind: 'nirvana' })
    } catch (err) {
      console.error(`[nirvana ${row.id.slice(0, 8)}]`, err instanceof Error ? err.message : err)
    }
  }

  /** A session's whole conversation, boiled down for the life-summary call: first ask, then the tail. */
  private lifeTranscript(id: string): string {
    const events = this.store.events(id).map((e) => e.ev)
    const first = events.find((e) => e.t === 'user.message')
    const lines = events.flatMap((ev) => {
      if (ev.t === 'user.message') return [`UTILISATEUR : ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'buddha.text') return [`AGENT : ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'monk.done') return [`SOUS-AGENT (${ev.status}) : ${ev.summary.slice(0, 800)}`]
      if (ev.t === 'recap') return [`RÉCAP : ${ev.done} — ${ev.next}`]
      return []
    })
    return [
      first && first.t === 'user.message' ? `DEMANDE INITIALE : ${first.text.slice(0, 3000)}` : '',
      '--- FIL (le plus récent en dernier) ---',
      lines.join('\n\n').slice(-9_000),
    ].join('\n\n')
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
      lotus: this.store.lotusIds().has(s.id),
      note: this.store.notes().get(s.id) ?? null,
      reminder: this.store.reminders().get(s.id) ?? null,
      env: {},
      renewal: this.renewalState(s.id),
      shepherd: this.shepherdState(s.id),
      cost: this.costOf(s.id),
      pr: s.cwd ? this.pulls.of(s.cwd) : null,
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
    // Renewal and shepherd questions both cost quota: none of that while the reserve holds everyone.
    if (this.renewing || this.blocked()) return
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
  /** `context`: what you hand over with him, read first by the fresh session (in a file under /tmp). */
  shepherd(id: string, on: boolean, context?: string) {
    const s = this.summaryOf(id)
    if (!s || id === BUDDHA_SESSION_ID) throw new UserError('session inconnue')
    if (!on) {
      this.store.setShepherd(id, null)
    } else {
      if (s.external && !s.alive) throw new UserError('son terminal est fermé : il ne peut pas répondre')
      const contextFile = context?.trim() ? writeHandoffContext(id, context.trim()) : null
      const cur = this.store.shepherd(id)
      if (cur?.state === 'pending' || cur?.state === 'asked') {
        // Already confided: a new context replaces the previous one.
        if (contextFile) this.store.setShepherd(id, { ...cur, contextFile })
        this.broadcastSession(id)
        return this.shepherdState(id)
      }
      const now = Date.now()
      // A fresh-session question already awaits his answer: take it over rather than ask a second one.
      const rec = this.store.renewal(id)
      if (rec?.state === 'asked') this.store.setShepherd(id, { state: 'asked', nextAt: now, askedAt: rec.askedAt, seenAt: rec.askedAt, attempts: 0, note: null, contextFile })
      else this.store.setShepherd(id, { state: 'pending', nextAt: now, askedAt: 0, seenAt: now, attempts: 0, note: null, contextFile })
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
      const words = this.wordsSince(s.id, sh.askedAt).filter((w) => w.trim())
      if (words.length) return this.shepherdDecide(s, sh, readDecision(words))
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
    const words = this.wordsSince(s.id, askedAt).filter((w) => w.trim())
    if (!words.length) return // not answered yet
    const answer = readDecision(words)
    const rec = this.store.renewal(s.id)!
    if (answer.kind !== 'yes') {
      this.store.setRenewal(s.id, { ...rec, state: 'postponed' })
      this.broadcastSession(s.id)
      return
    }
    await this.renew(s, answer.handoff)
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
      // The fresh session thinks with the same model.
      engine: old?.engine,
      model: old?.model,
    }
    this.store.createSession(row)
    // The bill follows the work: the fresh session starts from what the old one had cost.
    this.store.setCarriedCost(row.id, this.costOf(s.id) ?? 0)
    if (this.store.silencedIds().has(s.id)) this.store.setSilenced(row.id, true)
    if (this.store.lotusIds().has(s.id)) this.store.setLotus(row.id, true)
    const carriedNote = this.store.notes().get(s.id)
    if (carriedNote) this.store.setSessionNote(row.id, carriedNote)
    const carriedEnv = this.store.sessionEnv(s.id)
    if (Object.keys(carriedEnv).length) this.store.setSessionEnv(row.id, carriedEnv)
    const carriedReminder = this.store.reminders().get(s.id)
    if (carriedReminder) this.store.setReminder(row.id, carriedReminder)
    this.store.setSuccessor(s.id, row.id)
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
    this.send(row.id, renewalMessage(handoff, this.store.shepherd(s.id)?.contextFile ?? null))
  }

  /** Snuff out (or relight) a priest's incense: silenced, he no longer calls for you. */
  silence(id: string, silent: boolean) {
    if (!this.summaryOf(id)) throw new UserError('session inconnue')
    this.store.setSilenced(id, silent)
    this.broadcastSession(id)
  }

  /** Set a priest aside in the lotus pond, the courtyard's waiting room (or take him back out). */
  lotus(id: string, lotus: boolean) {
    if (!this.summaryOf(id)) throw new UserError('session inconnue')
    this.store.setLotus(id, lotus)
    this.broadcastSession(id)
  }

  /**
   * Stop his Claude process and start a new one on the same conversation: it rereads what is only read
   * at launch (his agent file and its tools, skills, settings, MCP). A turn in progress is interrupted.
   */
  async restart(id: string) {
    const row = this.priestRow(id)
    const old = this.live.get(id)
    if (old) {
      await old.interrupt()
      old.close()
      // Never two processes on one conversation: wait for the old one to be gone.
      await Promise.race([old.closed, new Promise((r) => setTimeout(r, 15_000))])
      if (this.live.get(id) === old) this.live.delete(id)
    }
    // He looks for what was missing as soon as he reads this: let his MCP servers finish connecting first
    // (a remote one like Sentry takes seconds), or he finds nothing and says it is still not there.
    const fresh = this.ensureLive(row)
    void mcpReady(() => fresh.mcpStatus()).then(() => this.send(row.id, RESTARTED))
  }

  /**
   * Changes the model he thinks with. Same endpoint: switched live, from his next reply on. Another endpoint
   * (Claude ↔ a provider): his process must start again with it, so he is relaunched on the same conversation.
   */
  async setModel(id: string, model: string) {
    const row = this.priestRow(id)
    const choice = await this.providers.choice(model)
    if (!choice) throw new UserError(`modèle indisponible : ${model}`)
    this.store.setModel(id, choice.engine, choice.model)
    this.broadcastSession(id)
    const live = this.live.get(id)
    if (!live) return // his next process starts with it
    if (choice.engine !== (row.engine ?? 'claude')) return this.restart(id)
    // '' : back to the model of his agent's definition.
    await live.setModel(choice.model ?? (priestOptions(row.agent).model as string | undefined))
  }

  /** A priest's MCP servers, waking his process to ask it. */
  async mcp(id: string): Promise<McpServer[]> {
    const row = this.priestRow(id)
    const statuses = await this.ensureLive(row).mcpStatus()
    const native = nativeMcp(statuses)
    const list = mcpList(statuses, this.catalog(row), this.store.mcpPrefs(), this.store.sessionMcpPrefs(id))
    for (const s of list) this.seenMcp.set(s.name, { scope: s.scope, native: native.has(s.name) })
    return list
  }

  /** Switch a server for this priest only, over the switch of all of Sangha (`enabled` null: back to it). */
  async toggleMcp(id: string, name: string, enabled: boolean | null): Promise<McpServer[]> {
    const row = this.priestRow(id)
    this.store.setSessionMcpPref(id, name, enabled)
    await this.applyMcp(row, this.ensureLive(row), name).catch((e) => {
      throw new UserError(`MCP ${name} : ${e instanceof Error ? e.message : String(e)}`)
    })
    return this.mcp(id)
  }

  /**
   * The servers you can switch for all of Sangha: your Claude config's, the active library ones, and the ones
   * priests load themselves (claude.ai, project), as last seen in a priest (one live priest is asked).
   */
  async globalMcp(): Promise<GlobalMcp[]> {
    const priest = [...this.live.entries()].find(([id]) => id !== BUDDHA_SESSION_ID && !id.startsWith(EXTERNAL_PREFIX))
    if (priest) await Promise.race([this.mcp(priest[0]), new Promise((r) => setTimeout(r, 5_000))]).catch(() => undefined)
    const catalog: Catalog = { ...readCatalog(null), ...library.catalog() }
    for (const [name, s] of Object.entries(catalog)) if (!this.seenMcp.has(name)) this.seenMcp.set(name, { scope: s.scope, native: false })
    const prefs = this.store.mcpPrefs()
    const names = new Set([...this.seenMcp.keys(), ...Object.keys(prefs)])
    return [...names].map((name) => {
      const seen = this.seenMcp.get(name)
      return { name, scope: seen?.scope ?? 'user', enabled: prefs[name] ?? seen?.native ?? false }
    })
  }

  /** Switch a server for all of Sangha: every live priest that does not override it follows, and the next ones. */
  async setGlobalMcp(name: string, enabled: boolean): Promise<GlobalMcp[]> {
    this.store.setMcpPref(name, enabled)
    for (const [id, s] of this.live) {
      const row = this.store.getSession(id)
      if (!row || id === BUDDHA_SESSION_ID || id.startsWith(EXTERNAL_PREFIX) || name in this.store.sessionMcpPrefs(id)) continue
      void this.applyMcp(row, s, name).catch(() => undefined)
    }
    return this.globalMcp()
  }

  /** Brings a live priest in line with his switches: one he loads himself is switched, a catalog one added or dropped. */
  private async applyMcp(row: SessionRow, s: LiveSession, name: string): Promise<void> {
    if (nativeMcp(await s.mcpStatus()).has(name)) return s.toggleMcp(name, this.store.sessionMcpPrefs(row.id)[name] ?? this.store.mcpPrefs()[name] ?? true)
    return s.setExtraMcp(this.mcpPlan(row).extras)
  }

  /** Sign in to a server that needs it (your browser opens), then reconnect it for the project's live priests. */
  async loginMcp(id: string, name: string): Promise<McpServer[]> {
    const row = this.priestRow(id)
    await mcpLogin(this.cwdOf(row) ?? this.projects.dir(row.project), name).catch((e) => {
      throw new UserError(`connexion à ${name} : ${e instanceof Error ? e.message : String(e)}`)
    })
    const own = this.ensureLive(row)
    for (const [otherId, s] of this.live) {
      if (s !== own && this.store.getSession(otherId)?.project === row.project) void s.reconnectMcp(name).catch(() => undefined)
    }
    // A reconnect can fail or time out (slow server, tools fetch) while the sign-in did work: retry, wait for
    // it to settle, and say why it is still not connected rather than show "Se connecter" again.
    const reason = await mcpSettle(
      async () => (await own.mcpStatus()).find((s) => s.name === name),
      () => own.reconnectMcp(name),
    )
    if (reason) throw new UserError(`connecté à ${name}, mais le prêtre n’arrive pas à le joindre (${reason}). Relance-le pour qu’il le recharge.`)
    return this.mcp(id)
  }

  private priestRow(id: string): SessionRow {
    const row = this.store.getSession(id)
    if (!row || row.archivedAt || id === BUDDHA_SESSION_ID || id.startsWith(EXTERNAL_PREFIX)) throw new UserError('session inconnue')
    return row
  }

  private catalog(row: SessionRow): Catalog {
    return { ...readCatalog(this.projects.dir(row.project)), ...library.catalog() }
  }

  /**
   * Activate or drop a library server. Activating it switches it on for all of Sangha too (a priest can still
   * switch it off for himself): live priests load or drop it.
   */
  setLibraryMcp(name: string, change: { active?: boolean; values?: Record<string, string> }) {
    try {
      library.set(name, change)
    } catch (e) {
      throw new UserError(`${name} : ${e instanceof Error ? e.message : String(e)}`)
    }
    if (change.active) this.store.setMcpPref(name, true)
    for (const [id, s] of this.live) {
      const row = this.store.getSession(id)
      if (row && id !== BUDDHA_SESSION_ID && !id.startsWith(EXTERNAL_PREFIX)) void s.setExtraMcp(this.mcpPlan(row).extras).catch(() => undefined)
    }
    return library.list()
  }

  /** At launch: servers to add from your Claude config, and switches to replay on the ones he loads himself. */
  private mcpPlan(row: SessionRow): { extras: Record<string, McpServerConfig>; toggles: Record<string, boolean> } {
    const catalog = this.catalog(row)
    const prefs = { ...this.store.mcpPrefs(), ...this.store.sessionMcpPrefs(row.id) }
    // Known to be loaded by priests themselves: switched, never added a second time.
    const native = (name: string) => this.seenMcp.get(name)?.native || !(name in catalog)
    return {
      extras: enabledExtras(Object.fromEntries(Object.entries(catalog).filter(([name]) => !native(name))), prefs),
      toggles: Object.fromEntries(Object.entries(prefs).filter(([name]) => native(name))),
    }
  }

  /** A free-text note pinned on a priest, for whatever you want to remember about him. */
  note(id: string, note: string | null) {
    if (!this.summaryOf(id)) throw new UserError('session inconnue')
    this.store.setSessionNote(id, note?.trim().slice(0, 500) || null)
    this.broadcastSession(id)
  }

  /** Your standing instruction for him, recalled with each of your messages (null clears it). */
  reminder(id: string, text: string | null) {
    if (!this.summaryOf(id)) throw new UserError('session inconnue')
    this.store.setReminder(id, text?.trim().slice(0, 500) || null)
    this.broadcastSession(id)
  }

  /** The message as he receives it: your words, then your standing instruction if you set one. The chat shows your words alone. */
  private withReminder(id: string, text: string) {
    const r = this.store.reminders().get(id)
    return r ? `${text}\n\n(Rappel permanent de l'utilisateur, à respecter : ${r})` : text
  }

  /**
   * Every few seconds: for working sessions whose sentence is missing or stale and whose history moved,
   * ask a small model what they are doing overall. One call at a time.
   */
  startDoingLoop() {
    const every = Number(process.env.SANGHA_DOING_EVERY_S ?? 90) * 1000
    setInterval(() => void this.refreshDoings(every), 10_000)
  }

  /**
   * Every few seconds: every non-archived, non-Buddha session with a folder gets its pull request
   * refreshed, at most every two minutes per folder (see PullRequests).
   */
  startPullsLoop() {
    setInterval(() => this.pulls.tick(this.pullCwds()), 10_000)
  }

  private pullCwds(): string[] {
    const cwds: string[] = []
    for (const s of this.summaries()) if (s.id !== BUDDHA_SESSION_ID && s.cwd) cwds.push(s.cwd)
    return cwds
  }

  /** A folder's cached pull request changed: re-broadcast every session working in it. */
  private pullsChanged(cwd: string) {
    for (const s of this.summaries()) if (s.cwd === cwd) this.broadcastSession(s.id)
  }

  private async refreshDoings(every: number) {
    if (this.doingBusy || this.blocked()) return
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
  /** `fresh`: asked again on purpose (the ↻ button), even if the state it describes has not moved. */
  progressOf(id: string, fresh = false): Promise<Progress | null> {
    const summary = this.summaryOf(id)
    const file = id.startsWith(EXTERNAL_PREFIX) ? this.observer?.fileOf(id) : null
    // The state described: when an outside transcript last moved, or the last time a Sangha priest stopped.
    const key = file ? String(statSync(file).mtimeMs) : `idle:${this.store.lastIdleSeq(id)}`
    const stored = this.store.note<Progress>(id, 'progress')
    if (!fresh && stored && (stored.key === key || (summary?.status === 'working' && Date.now() - stored.at < 10 * 60_000))) return Promise.resolve(stored.value)
    // The reserve holds everyone: no fresh call, just what was already known.
    if (this.blocked()) return Promise.resolve(stored?.value ?? null)
    const inflight = this.progressCache.get(id)
    if (inflight && (inflight.key === key || fresh)) return inflight.value
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
    for (const r of this.remotes.values()) r.stop()
  }

  /** The folder a session works in: its worktree, or the project itself. Null for Buddha (not project-bound). */
  private cwdOf(row: SessionRow): string | null {
    if (row.id === BUDDHA_SESSION_ID) return null
    return row.worktree ?? (this.projects.exists(row.project) ? this.projects.dir(row.project) : null)
  }

  private summary(row: SessionRow): SessionSummary {
    const live = this.live.get(row.id)
    const cwd = this.cwdOf(row)
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
      engine: row.engine,
      model: row.model ?? null,
      status,
      activity: live?.activity ?? null,
      doing: live?.busy ? (this.doingOf(row.id)?.text ?? null) : null,
      novices: live ? [...live.novices.values()] : [],
      recap: status === 'working' ? null : this.currentRecap(row.id),
      external: false,
      alive: false,
      silenced: this.store.silencedIds().has(row.id),
      lotus: this.store.lotusIds().has(row.id),
      note: this.store.notes().get(row.id) ?? null,
      reminder: this.store.reminders().get(row.id) ?? null,
      autonomy: this.store.lastAutonomy(row.id),
      env: this.store.sessionEnv(row.id),
      queued: this.store.queued(row.id),
      context: row.id === BUDDHA_SESSION_ID ? null : this.contextOf(row),
      renewal: this.renewalState(row.id),
      shepherd: this.shepherdState(row.id),
      cost: this.costOf(row.id),
      cwd,
      pr: cwd ? this.pulls.of(cwd) : null,
      scripts: live?.scripts ?? [],
      remote: this.remotes.get(row.id)?.url ?? null,
      remotePending: this.remotePending.has(row.id),
    }
  }

  private currentRecap(id: string): SessionRecap | null {
    const r = this.store.lastEvent(id, 'recap')
    const user = this.store.lastEvent(id, 'user.message')
    return r && (!user || r.seq > user.seq) ? { done: r.ev.done, next: r.ev.next, ...(r.ev.state && { state: r.ev.state }) } : null
  }

  /** Commits as the identity set in Sangha, and no git at all while there is none. */
  private withGit(o: Partial<Options>, sessionId: string): Partial<Options> {
    // His own variables on top of his engine's environment, under what Sangha must keep (see RESERVED_ENV).
    const env = { ...(o.env ?? process.env), ...this.store.sessionEnv(sessionId) } as Record<string, string>
    delete env.ANTHROPIC_API_KEY // belt and braces: never bill the API
    if (!this.git) return { ...o, env }
    // Identity variables (e.g. from a .env) would beat any git config: the one set in Sangha must win.
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k]
    return { ...o, env: { ...env, ...this.git.env() }, hooks: { ...o.hooks, PreToolUse: [...(o.hooks?.PreToolUse ?? []), ...this.git.hooks().PreToolUse] } }
  }

  /** Refuses every tool (his own and his novices') while the quota reserve holds him. */
  private withReserve(o: Partial<Options>): Partial<Options> {
    const deny: HookCallback = async () => {
      if (!this.reserve.reached) return {}
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reserveMessage(this.reserve, this.quota) } }
    }
    return { ...o, hooks: { ...o.hooks, PreToolUse: [...(o.hooks?.PreToolUse ?? []), { hooks: [deny] }] } }
  }

  /** Sets his own environment variables; they take effect when his process starts (now, if `restart`). */
  async setEnv(id: string, input: unknown, restart: boolean) {
    this.priestRow(id)
    let env: Record<string, string>
    try {
      env = checkSessionEnv(input)
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e))
    }
    this.store.setSessionEnv(id, env)
    this.broadcastSession(id)
    if (restart && this.live.get(id)) await this.restart(id)
  }

  /** His model and, on a provider, its environment. A provider removed since: back to Claude and his agent's model. */
  private engineOptions(row: SessionRow): Partial<Options> {
    const onProvider = !!row.engine && row.engine !== 'claude'
    if (onProvider && !this.providers.get(row.engine!)) return {}
    return { ...(row.model && { model: row.model }), ...(onProvider && { env: this.providers.env(row.engine, row.model) }) }
  }

  private ensureLive(row: SessionRow): LiveSession {
    if (this.remotes.has(row.id)) throw new UserError('il est en Remote Control : arrête-le d’abord')
    let s = this.live.get(row.id)
    if (!s) {
      const isBuddha = row.id === BUDDHA_SESSION_ID
      const cwd = isBuddha ? config.workspacesDir : (row.worktree ?? this.projects.dir(row.project))
      const mcp = isBuddha ? null : this.mcpPlan(row)
      s = new LiveSession(
        row,
        cwd,
        this.withReserve(this.withGit(isBuddha ? this.buddhaOptions(this) : { ...priestOptions(row.agent), ...this.engineOptions(row), mcpServers: mcp!.extras }, row.id)),
        (ev) => this.emit(row.id, ev),
        () => {
          if (this.live.get(row.id) === s) this.live.delete(row.id)
          this.broadcastSession(row.id)
          this.flushQueued(row.id)
        },
        (claudeId) => this.store.setClaudeSessionId(row.id, claudeId),
        (taskId, command) => this.scriptSummaries.request(row.id, taskId, command, row.title),
        () => !!this.activeLoop(row.id),
        mcp?.toggles,
      )
      this.live.set(row.id, s)
      this.rearmLoop(row.id, s)
    }
    return s
  }

  /** The active `/loop`, if any (never for Buddha, who has none). */
  private activeLoop(id: string): Extract<AutonomyState, { mode: 'loop' }> | null {
    if (id === BUDDHA_SESSION_ID) return null
    const a = this.store.lastAutonomy(id)
    return a?.mode === 'loop' && a.active ? a : null
  }

  /**
   * A `/loop`'s CronCreate jobs and ScheduleWakeup live only inside the Claude process that had it: once
   * that process ends for any reason other than the loop itself being stopped (a server restart, Relancer,
   * Remote Control taking over, a crash…), none of that schedule survives into the fresh one. Re-sending
   * the exact `/loop [interval ]text` that started it — as a real message in his own conversation, right
   * when the fresh process is created — is the only way it gets re-armed. Called once per process, only
   * from `ensureLive`'s own construction branch: a plain message to one already alive must never re-send it.
   */
  private rearmLoop(id: string, live: LiveSession) {
    const loop = this.activeLoop(id)
    if (!loop) return
    const cmd = `/loop ${loop.interval ? `${loop.interval} ` : ''}${loop.text}`
    this.emit(id, { t: 'user.message', text: cmd })
    live.send(cmd)
  }

  private emit(id: string, ev: MonasteryEvent) {
    const env = this.store.append(id, ev)
    for (const fn of this.listeners.get(id) ?? []) fn(env)
    if (ev.t === 'quota') {
      this.quota = ev.quota
      for (const fn of this.globalListeners) fn({ kind: 'quota', quota: ev.quota })
      this.reevaluateReserve()
    }
    if (SUMMARY_EVENTS.has(ev.t)) this.broadcastSession(id)
    if (ev.t === 'turn.done') this.flushQueued(id)
    if (ev.t === 'busy' && !ev.busy && id !== BUDDHA_SESSION_ID) {
      void this.writeRecap(id, env.seq)
      this.pullSoonAfter(id) // he may just have run `gh pr create`
      if (this.remotePending.has(id)) void this.fireRemotePending(id)
    }
    if ((ev.t === 'monk.tool' || ev.t === 'buddha.tool') && ev.summary.includes('gh pr')) this.pullSoonAfter(id)
  }

  /** A session likely just touched a pull request: check its folder again in a few seconds. */
  private pullSoonAfter(id: string) {
    const row = this.store.getSession(id)
    const cwd = row ? this.cwdOf(row) : null
    if (cwd) setTimeout(() => this.pulls.soon(cwd), 5_000)
  }

  /** When a priest stops, a small model writes what he did and what is left. Dropped if he resumed meanwhile. */
  private async writeRecap(id: string, idleSeq: number) {
    if (this.blocked()) return
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
