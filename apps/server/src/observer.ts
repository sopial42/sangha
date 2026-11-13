import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import type { SubagentSummary, SessionSummary } from '@sangha/shared'
import { readHead, readTailLines } from './files'
import { currentBranch } from './git'
import { CLAUDE_PROJECTS, encodeDir, type Projects } from './projects'
import { claudeAncestor, isClaude, launcherFromEnv, parseProcs, sessionIdOf } from './processes'
import type { Store } from './db'
import { recap, type Recap } from './recap'
import { aiTitle, contextTokens, firstPrompt, lastTool, lastUserMessageAt, latestPrompt, mainAgent, parseLine, TranscriptReader } from './transcript'

// A session counts while its transcript moved within this window; it works while it moved very recently.
const WINDOW_MS = Number(process.env.SANGHA_EXTERNAL_WINDOW_MIN ?? 90) * 60_000
const WORKING_MS = 25_000
const SCAN_MS = 4_000

export const EXTERNAL_PREFIX = 'ext:'

type Found = { summary: SessionSummary; file: string; proc: { pid: number; cwd: string } | null }

const exec = promisify(execFile)

/** `parent`: the Claude Code session id of the `claude` process that launched this one (a headless `claude -p`). */
type Live = { pid: number; cwd: string; file: string | null; parent: string | null }

/**
 * `claude` processes running on this machine, with their folder and transcript, so an open but idle
 * session is still seen. SDK-driven processes (Sangha's own) are left out, but each one left is tied to
 * the `claude` process above it, if any: the session that launched it.
 */
async function liveClaudes(): Promise<Live[]> {
  let out: string
  try {
    out = (await exec('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 8 * 1024 * 1024 })).stdout
  } catch {
    return []
  }
  const procs = parseProcs(out)
  const found: (Live & { above: number | null })[] = []
  for (const p of procs.values()) {
    if (!isClaude(p.command) || p.command.includes('claude-agent-sdk') || p.command.includes('stream-json')) continue
    const cwd = await cwdOf(p.pid)
    if (!cwd) continue
    const id = sessionIdOf(p.command)
    const above = claudeAncestor(p.pid, procs)
    const launcher = await launcherOf(p.pid)
    const dir = join(CLAUDE_PROJECTS, encodeDir(cwd))
    let file: string | null = id && existsSync(join(dir, `${id}.jsonl`)) ? join(dir, `${id}.jsonl`) : null
    if (!file && existsSync(dir)) {
      // No explicit id: the transcript of that folder most recently written.
      const newest = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]
      file = newest?.f ?? null
    }
    found.push({ pid: p.pid, cwd, file, parent: launcher && launcher !== (id ?? file?.replace(/^.*\/|\.jsonl$/g, '')) ? launcher : above ? sessionIdOf(above.command) : null, above: above?.pid ?? null })
  }
  // A launcher started without an explicit id: its session is the transcript its own process writes.
  return found.map(({ above, ...l }) => ({
    ...l,
    parent: l.parent ?? (above === null ? null : (found.find((f) => f.pid === above)?.file?.replace(/^.*\/|\.jsonl$/g, '') ?? null)),
  }))
}

/** The session that launched this process, from its environment (see `launcherFromEnv`). */
async function launcherOf(pid: number): Promise<string | null> {
  try {
    return launcherFromEnv(readFileSync(`/proc/${pid}/environ`, 'utf8')) // Linux
  } catch {
    try {
      return launcherFromEnv((await exec('ps', ['eww', '-o', 'command=', '-p', String(pid)], { maxBuffer: 4 * 1024 * 1024 })).stdout) // macOS
    } catch {
      return null
    }
  }
}

async function cwdOf(pid: number): Promise<string | null> {
  try {
    return readlinkSync(`/proc/${pid}/cwd`) // Linux
  } catch {
    try {
      const { stdout } = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']) // macOS
      return stdout.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null
    } catch {
      return null
    }
  }
}

/**
 * Sees Claude Code sessions started outside Sangha (a terminal, an IDE) on Sangha's projects,
 * including in their git worktrees, by reading ~/.claude/projects transcripts. Read-only.
 */
export class Observer {
  private found = new Map<string, Found>()
  private seenAt = new Map<string, number>()
  private titles = new Map<string, string>()
  // Haiku recaps of stopped sessions, keyed by the transcript state they describe.
  private recaps = new Map<string, { key: number; recap: Recap | null }>()
  private recapQueue: string[] = []
  private recapping = false
  private agents = new Map<string, string>()
  // Headless sessions launched by another one (transcript → parent's Claude Code session id), remembered
  // past their process so a finished one stays by its parent, like any session, until it ages out.
  private children = new Map<string, string>()
  private first = true
  private timer: NodeJS.Timeout | undefined

  constructor(
    private store: Store,
    private projects: Projects,
    /** Claude Code session id → Sangha session id, for Sangha's own sessions. */
    private ownSessionIds: () => Map<string, string>,
    private onChange: (changed: SessionSummary[], removed: string[]) => void,
    private onProjectsAdded: () => void,
    /** An outside session's folder, once it stops working (it may just have run `gh pr create`). */
    private onStoppedWorking: (cwd: string) => void = () => {},
  ) {
    this.hidden = store.hiddenSessions()
  }

  // Sessions hidden from the board, with the activity they had then: they return if they move again.
  // Kept in the database so a server restart does not bring them back.
  private hidden: Map<string, number>

  /**
   * Hide an outside session from the board (its terminal is not touched). It stays away while it
   * works on its own, and comes back only when you write to it again; never if `forever` (it moved on to
   * a fresh session).
   */
  hide(id: string, forever = false) {
    // Never shortens an earlier "forever".
    const at = Math.max(forever ? Number.MAX_SAFE_INTEGER : Date.now(), this.hidden.get(id) ?? 0)
    this.hidden.set(id, at)
    this.store.setHidden(id, at)
    if (this.found.delete(id)) this.onChange([], [id])
  }

  start() {
    const tick = () =>
      this.scan()
        .catch((e) => console.error('[observer]', e instanceof Error ? e.message : e))
        .finally(() => (this.timer = setTimeout(tick, SCAN_MS)))
    void tick()
  }

  stop() {
    clearTimeout(this.timer)
  }

  summaries = () => [...this.found.values()].map((f) => f.summary)
  summaryOf = (id: string) => this.found.get(id)?.summary ?? null
  fileOf = (id: string) => this.found.get(id)?.file ?? null
  procOf = (id: string) => this.found.get(id)?.proc ?? null

  /** Transcript of one of an outside session's subagents, by the tool_use id that summoned it. */
  subagentFile(id: string, subagentId: string): string | null {
    const file = this.fileOf(id)
    if (!file) return null
    const dir = join(file.replace(/\.jsonl$/, ''), 'subagents')
    if (!existsSync(dir)) return null
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.meta.json')) continue
      try {
        const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { toolUseId?: string }
        if (meta.toolUseId === subagentId) return join(dir, f.replace(/\.meta\.json$/, '.jsonl'))
      } catch {
        // unreadable meta: skip
      }
    }
    return null
  }

  seen(id: string) {
    this.seenAt.set(id, Date.now())
  }

  private async scan() {
    if (!existsSync(CLAUDE_PROJECTS)) return
    const now = Date.now()
    const own = this.ownSessionIds()
    const next = new Map<string, Found>()
    let added = false
    const live = await liveClaudes()
    const liveFiles = new Set(live.flatMap((l) => (l.file ? [l.file] : [])))

    for (const d of readdirSync(CLAUDE_PROJECTS)) {
      const dir = join(CLAUDE_PROJECTS, d)
      let files: { path: string; mtime: number; birth: number }[]
      try {
        if (now - statSync(dir).mtimeMs > WINDOW_MS && !this.hasRecent(dir, now) && ![...liveFiles].some((f) => f.startsWith(dir + '/'))) continue
        files = readdirSync(dir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => {
            const st = statSync(join(dir, f))
            return { path: join(dir, f), mtime: st.mtimeMs, birth: st.birthtimeMs }
          })
          .filter((f) => now - f.mtime < WINDOW_MS || liveFiles.has(f.path))
      } catch {
        continue
      }
      for (const f of files) {
        const sessionId = basename(f.path, '.jsonl')
        if (own.has(sessionId)) continue
        const proc = live.find((l) => l.file === f.path)
        if (proc?.parent) this.children.set(f.path, proc.parent)
        const launcher = this.children.get(f.path) ?? null
        const tail = readTailLines(f.path, 256 * 1024).map(parseLine).filter((l) => l !== null)
        // Sessions driven through an SDK (Sangha itself, other tools) are not someone at a terminal; unless a
        // session launched it (`claude -p` from its shell): then it is one of that session's own subagents.
        if (!launcher && tail.some((l) => l.entrypoint?.startsWith('sdk'))) continue
        // The latest folder that belongs to a project (tools may briefly cd into scratch folders);
        // if none does yet, the session's own folder becomes a project: every agent gets its project.
        const cwds = [...new Set([...tail].reverse().flatMap((l) => (l.cwd ? [l.cwd] : [])))]
        if (proc && !cwds.includes(proc.cwd)) cwds.push(proc.cwd)
        let cwd: string | null = null
        let project: string | undefined
        for (const c of cwds) {
          const r = await this.projects.resolve(c, false)
          if (r) {
            cwd = c
            project = r.name
            break
          }
        }
        if (!project) {
          for (const c of cwds) {
            const r = await this.projects.resolve(c, true)
            if (r) {
              cwd = c
              project = r.name
              added ||= r.added
              break
            }
          }
        }
        if (!cwd || !project) continue
        const id = EXTERNAL_PREFIX + sessionId
        const subagents = this.subagents(f.path, now)
        const lastMove = Math.max(f.mtime, ...subagents.map((n) => n.mtime))
        // Sent away: it comes back only once you wrote to it after that, not because it keeps working.
        const hiddenAt = this.hidden.get(id)
        if (hiddenAt !== undefined && hiddenAt >= (lastUserMessageAt(tail) ?? 0)) continue
        // A headless child session works as long as its process runs: it ends with its task.
        const working = now - lastMove < WORKING_MS || (!!launcher && !!proc)
        // Sessions found at startup count as already seen: only new activity should call for you. A launched
        // child session never calls for you: it answers to the session that launched it.
        if (launcher || (this.first && !this.seenAt.has(id))) this.seenAt.set(id, lastMove)
        // Not working: it ended its turn and waits for your input.
        const status = working ? 'working' : 'waiting'
        if (!this.first && this.found.get(id)?.summary.status === 'working' && status !== 'working') this.onStoppedWorking(cwd)
        const cached = this.recapOf(id)
        const title = aiTitle(tail) ?? latestPrompt(tail) ?? this.titles.get(id) ?? this.title(f.path)
        this.titles.set(id, title)
        // The agent it runs as (`claude --agent kiat-team-lead`), else plain Claude.
        const agent = mainAgent(tail) ?? this.agents.get(id) ?? this.agentFromHead(f.path)
        this.agents.set(id, agent)
        next.set(id, {
          file: f.path,
          proc: proc ? { pid: proc.pid, cwd: proc.cwd } : null,
          summary: {
            id,
            project,
            agent,
            title,
            createdAt: f.birth,
            claudeSessionId: sessionId,
            // Where it is now, asked to git rather than to the transcript.
            branch: realBranch((await currentBranch(cwd)) ?? [...tail].reverse().find((l) => l.gitBranch)?.gitBranch ?? null),
            status,
            activity: working ? formatTool(lastTool(tail)) : null,
            doing: null,
            subagents: subagents.filter((n) => now - n.mtime < WORKING_MS).map(({ mtime: _m, ...n }) => n),
            recap: !working && cached?.key === f.mtime ? cached.recap : null,
            external: true,
            alive: !!proc,
            silenced: false, // decorated by Sessions
            setAside: false, // decorated by Sessions
            note: null, // decorated by Sessions
            reminder: null,
            // Not tracked for an outside session: its `/goal` or `/loop` would go straight to its own terminal,
            // never through Sangha's event log `lastAutonomy` reads from.
            autonomy: null,
            env: {},
            queued: [],
            context: contextTokens(tail),
            renewal: null, // decorated by Sessions
            handoff: null,
            cost: null, // decorated by Sessions
            cwd,
            pr: null, // decorated by Sessions
            scripts: [], // outside sessions: not followed live, so no script tracking
            parent: launcher && (own.get(launcher) ?? EXTERNAL_PREFIX + launcher),
          },
        })
      }
    }
    this.first = false
    // A launcher Sangha does not see (gone, hidden, outside any project): its child sessions stand on their own.
    for (const f of next.values()) {
      const p = f.summary.parent
      if (p?.startsWith(EXTERNAL_PREFIX) && !next.has(p)) f.summary = { ...f.summary, parent: null }
    }
    const shown = new Set([...next.values()].map((f) => f.file))
    for (const file of this.children.keys()) {
      if (!shown.has(file) && (!existsSync(file) || now - statSync(file).mtimeMs > WINDOW_MS)) this.children.delete(file)
    }
    if (added) this.onProjectsAdded()
    // Stopped sessions without a current recap get one, one call at a time.
    for (const f of next.values()) {
      const s = f.summary
      if (s.status === 'working' || this.recapOf(s.id)?.key === statSync(f.file).mtimeMs || this.recapQueue.includes(s.id)) continue
      this.recapQueue.push(s.id)
    }
    void this.drainRecaps()

    const changed = [...next.values()].map((f) => f.summary).filter((s) => JSON.stringify(s) !== JSON.stringify(this.found.get(s.id)?.summary))
    const removed = [...this.found.keys()].filter((id) => !next.has(id))
    this.found = next
    if (changed.length || removed.length) this.onChange(changed, removed)
  }

  /** A stopped session's recap, from memory or from the base (it survives restarts). */
  private recapOf(id: string) {
    let r = this.recaps.get(id)
    if (!r) {
      const n = this.store.note<Recap>(id, 'recap')
      if (n) this.recaps.set(id, (r = { key: Number(n.key), recap: n.value }))
    }
    return r
  }

  private async drainRecaps() {
    if (this.recapping) return
    this.recapping = true
    try {
      for (let id = this.recapQueue.shift(); id; id = this.recapQueue.shift()) {
        const f = this.found.get(id)
        if (!f || f.summary.status === 'working') continue
        const key = statSync(f.file).mtimeMs
        const r = await recap(lastExchange(f.file)).catch(() => null)
        this.recaps.set(id, { key, recap: r })
        if (r) this.store.setNote(id, 'recap', String(key), r)
        const now = this.found.get(id)
        if (r && now && now.summary.status !== 'working' && statSync(now.file).mtimeMs === key) {
          now.summary = { ...now.summary, recap: r }
          this.onChange([now.summary], [])
        }
      }
    } finally {
      this.recapping = false
    }
  }

  private hasRecent(dir: string, now: number) {
    try {
      return readdirSync(dir).some((f) => f.endsWith('.jsonl') && now - statSync(join(dir, f)).mtimeMs < WINDOW_MS)
    } catch {
      return false
    }
  }

  private agentFromHead(file: string): string {
    const head = readHead(file, 256 * 1024)
      .split('\n')
      .map(parseLine)
      .filter((l) => l !== null)
    return mainAgent(head) ?? 'claude'
  }

  private title(file: string): string {
    const head = readHead(file, 256 * 1024)
      .split('\n')
      .map(parseLine)
      .filter((l) => l !== null)
    return firstPrompt(head) ?? 'Claude Code session'
  }

  /** Subagents live next to the transcript: <session>/subagents/agent-*.jsonl with a .meta.json. */
  private subagents(transcript: string, now: number): (SubagentSummary & { mtime: number })[] {
    const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
    if (!existsSync(dir)) return []
    const out: (SubagentSummary & { mtime: number })[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(dir, f)
      const mtime = statSync(path).mtimeMs
      if (now - mtime > WINDOW_MS) continue
      let meta: { agentType?: string; description?: string; toolUseId?: string } = {}
      try {
        meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
      } catch {
        // no meta: still a subagent
      }
      const lines = now - mtime < WORKING_MS ? readTailLines(path, 64 * 1024).map(parseLine).filter((l) => l !== null) : []
      out.push({
        subagentId: meta.toolUseId ?? basename(f, '.jsonl'),
        agentType: meta.agentType ?? 'general-purpose',
        description: meta.description ?? '',
        lastTool: lastTool(lines),
        mtime,
      })
    }
    return out
  }
}

// 'HEAD' is what git answers outside a repository or before the first commit: no branch to show.
const realBranch = (b: string | null) => (b && b !== 'HEAD' ? b : null)

/** The session's latest exchange (your last message onward), as text for a recap. */
function lastExchange(file: string): string {
  const reader = new TranscriptReader()
  const events = readTailLines(file, 2 * 1024 * 1024)
    .map(parseLine)
    .filter((l) => l !== null)
    .flatMap((l) => reader.push(l))
  const from = events.findLastIndex((e) => e.t === 'user.message')
  return events
    .slice(Math.max(0, from))
    .flatMap((ev) => {
      if (ev.t === 'user.message') return [`USER: ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'assistant.text') return [`AGENT: ${ev.text.slice(0, 3000)}`]
      if (ev.t === 'subagent.done') return [`SUBAGENT (${ev.status}): ${ev.summary.slice(0, 1200)}`]
      return []
    })
    .join('\n\n')
}

const formatTool = (t: { tool: string; summary: string } | null) => (t ? (t.summary ? `${t.tool} · ${t.summary}` : t.tool) : null)
