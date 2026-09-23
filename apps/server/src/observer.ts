import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import type { NoviceSummary, SessionSummary } from '@sangha/shared'
import { readHead, readTailLines } from './files'
import { currentBranch } from './git'
import { CLAUDE_PROJECTS, encodeDir, type Projects } from './projects'
import type { Store } from './db'
import { recap, type Recap } from './recap'
import { aiTitle, contextTokens, firstPrompt, lastTool, latestPrompt, mainAgent, parseLine, TranscriptReader } from './transcript'

// A session counts while its transcript moved within this window; it works while it moved very recently.
const WINDOW_MS = Number(process.env.SANGHA_EXTERNAL_WINDOW_MIN ?? 90) * 60_000
const WORKING_MS = 25_000
const SCAN_MS = 4_000

export const EXTERNAL_PREFIX = 'ext:'

type Found = { summary: SessionSummary; file: string; proc: { pid: number; cwd: string } | null }

const exec = promisify(execFile)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/


type Live = { pid: number; cwd: string; file: string | null }

/**
 * `claude` processes running on this machine, with their folder and transcript, so an open but idle
 * session is still seen. SDK-driven processes (Sangha's own) are left out.
 */
async function liveClaudes(): Promise<Live[]> {
  let out = ''
  try {
    out = (await exec('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 })).stdout
  } catch {
    return []
  }
  const found: Live[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)(.*)$/.exec(line)
    if (!m || basename(m[2]!) !== 'claude' || m[0].includes('claude-agent-sdk') || m[3]!.includes('stream-json')) continue
    const pid = Number(m[1])
    const cwd = await cwdOf(pid)
    if (!cwd) continue
    const args = m[3]!.trim().split(/\s+/)
    const flag = args.findIndex((a) => a === '--resume' || a === '-r' || a === '--session-id')
    const id = flag >= 0 && UUID.test(args[flag + 1] ?? '') ? args[flag + 1]! : null
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
    found.push({ pid, cwd, file })
  }
  return found
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
 * Sees Claude Code sessions started outside Sangha (a terminal, an IDE) on the monastery's projects,
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
  private first = true
  private timer: NodeJS.Timeout | undefined

  constructor(
    private store: Store,
    private projects: Projects,
    private ownSessionIds: () => Set<string>,
    private onChange: (changed: SessionSummary[], removed: string[]) => void,
    private onProjectsAdded: () => void,
  ) {
    this.hidden = store.hiddenSessions()
  }

  // Sessions sent away from the courtyard, with the activity they had then: they return if they move again.
  // Kept in the database so a server restart does not bring them back.
  private hidden: Map<string, number>

  /**
   * Send an outside session away from the courtyard (its terminal is not touched). It comes back if it moves
   * again, unless `forever` (it moved on to a fresh session).
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

  /** Transcript of one of an outside session's novices, by the tool_use id that summoned him. */
  noviceFile(id: string, monkId: string): string | null {
    const file = this.fileOf(id)
    if (!file) return null
    const dir = join(file.replace(/\.jsonl$/, ''), 'subagents')
    if (!existsSync(dir)) return null
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.meta.json')) continue
      try {
        const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { toolUseId?: string }
        if (meta.toolUseId === monkId) return join(dir, f.replace(/\.meta\.json$/, '.jsonl'))
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
        const tail = readTailLines(f.path, 256 * 1024).map(parseLine).filter((l) => l !== null)
        // Sessions driven through an SDK (Sangha itself, other tools) are not someone at a terminal.
        if (tail.some((l) => l.entrypoint?.startsWith('sdk'))) continue
        // The latest folder that belongs to a project (tools may briefly cd into scratch folders);
        // if none does yet, the session's own folder becomes a project: every agent gets its pavilion.
        const cwds = [...new Set([...tail].reverse().flatMap((l) => (l.cwd ? [l.cwd] : [])))]
        const proc = live.find((l) => l.file === f.path)
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
        const novices = this.novices(f.path, now)
        const lastMove = Math.max(f.mtime, ...novices.map((n) => n.mtime))
        if ((this.hidden.get(id) ?? 0) >= lastMove) continue
        const working = now - lastMove < WORKING_MS
        // Sessions found at startup count as already seen: only new activity should call for you.
        if (this.first && !this.seenAt.has(id)) this.seenAt.set(id, lastMove)
        // Not working: it ended its turn and waits for your input.
        const status = working ? 'working' : 'waiting'
        const cached = this.recapOf(id)
        const title = aiTitle(tail) ?? latestPrompt(tail) ?? this.titles.get(id) ?? this.title(f.path)
        this.titles.set(id, title)
        // The agent he runs as (`claude --agent kiat-team-lead`), else plain Claude.
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
            // Where he is now, asked to git rather than to the transcript.
            branch: realBranch((await currentBranch(cwd)) ?? [...tail].reverse().find((l) => l.gitBranch)?.gitBranch ?? null),
            status,
            activity: working ? formatTool(lastTool(tail)) : null,
            doing: null,
            novices: novices.filter((n) => now - n.mtime < WORKING_MS).map(({ mtime: _m, ...n }) => n),
            recap: !working && cached?.key === f.mtime ? cached.recap : null,
            external: true,
            alive: !!proc,
            silenced: false, // decorated by Sessions
            context: contextTokens(tail),
            renewal: null, // decorated by Sessions
            cost: null, // decorated by Sessions
            cwd,
          },
        })
      }
    }
    this.first = false
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
    return firstPrompt(head) ?? 'Session Claude Code'
  }

  /** Subagents live next to the transcript: <session>/subagents/agent-*.jsonl with a .meta.json. */
  private novices(transcript: string, now: number): (NoviceSummary & { mtime: number })[] {
    const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
    if (!existsSync(dir)) return []
    const out: (NoviceSummary & { mtime: number })[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(dir, f)
      const mtime = statSync(path).mtimeMs
      if (now - mtime > WINDOW_MS) continue
      let meta: { agentType?: string; description?: string; toolUseId?: string } = {}
      try {
        meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
      } catch {
        // no meta: still a novice
      }
      const lines = now - mtime < WORKING_MS ? readTailLines(path, 64 * 1024).map(parseLine).filter((l) => l !== null) : []
      out.push({
        monkId: meta.toolUseId ?? basename(f, '.jsonl'),
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
      if (ev.t === 'user.message') return [`UTILISATEUR : ${ev.text.slice(0, 2000)}`]
      if (ev.t === 'buddha.text') return [`AGENT : ${ev.text.slice(0, 3000)}`]
      if (ev.t === 'monk.done') return [`SOUS-AGENT (${ev.status}) : ${ev.summary.slice(0, 1200)}`]
      return []
    })
    .join('\n\n')
}

const formatTool = (t: { tool: string; summary: string } | null) => (t ? (t.summary ? `${t.tool} · ${t.summary}` : t.tool) : null)
