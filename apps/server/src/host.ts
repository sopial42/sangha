import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { cpus, hostname, platform, totalmem } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type {
  HostContainer,
  HostLevel,
  HostMetric,
  HostMetricKey,
  HostProcess,
  HostReport,
  HostSample,
  HostSuggestion,
  HostWorktree,
  SessionSummary,
} from '@sangha/shared'
import { worktreeComments, type WorktreeCommentInput } from './recap'

const SAMPLE_MS = 10_000
const SIZE_MS = 5 * 60_000
const HISTORY = 180 // 30 min at one sample every 10 s
export const RED_AFTER_MS = 5 * 60_000

/** Run a command, its output in the C locale (macOS would print "132,1" in French). Null when it fails. */
function run(cmd: string, args: string[], timeout = 8_000): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } }, (err, out) =>
      resolve(err && !out ? null : String(out)),
    ),
  )
}

export const GB = 1024 ** 3

/** "12.3 Go", "512 Mo". */
export function bytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 100 * GB ? 0 : 1)} Go`
  return `${Math.round(n / 1024 ** 2)} Mo`
}

// ── Parsers (pure, tested) ──────────────────────────────────────────────────

/** macOS `vm_stat`: bytes available again without swapping (free, inactive, speculative, purgeable pages). */
export function parseVmStat(out: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1])
  if (!page) return null
  const pages = (name: string) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(out)?.[1] ?? 0)
  return (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page
}

const UNITS: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: GB, T: 1024 ** 4 }

/** macOS `sysctl -n vm.swapusage`: "total = 17408.00M  used = 16753.19M  free = 654.81M". */
export function parseSwapUsage(out: string): { total: number; used: number } | null {
  const get = (k: string) => {
    const m = new RegExp(`${k} = ([\\d.,]+)([BKMGT])`).exec(out)
    return m ? Number(m[1]!.replace(',', '.')) * UNITS[m[2]!]! : null
  }
  const total = get('total')
  const used = get('used')
  return total == null || used == null ? null : { total, used }
}

/** Linux /proc/meminfo, in bytes. */
export function parseMeminfo(out: string): { total: number; available: number; swapTotal: number; swapFree: number } | null {
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(out)?.[1] ?? NaN) * 1024
  const r = { total: kb('MemTotal'), available: kb('MemAvailable'), swapTotal: kb('SwapTotal'), swapFree: kb('SwapFree') }
  return Number.isNaN(r.total) || Number.isNaN(r.available) ? null : r
}

/** `ps -Ao pid=,pcpu=,rss=,comm=`: the heaviest by CPU. */
export function parsePs(out: string, limit = 8): HostProcess[] {
  const procs: HostProcess[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!m) continue
    const command = m[4]!.trim()
    procs.push({ pid: Number(m[1]), cpu: Number(m[2]), rssBytes: Number(m[3]) * 1024, command: command.split('/').pop() || command })
  }
  return procs.sort((a, b) => b.cpu - a.cpu).slice(0, limit)
}

/** "50MiB", "1.2GiB", "800kB" → bytes. */
function sizeOf(s: string): number {
  const m = /([\d.]+)\s*([KMGT]?)i?B/i.exec(s)
  return m ? Number(m[1]) * (UNITS[m[2]!.toUpperCase() || 'B'] ?? 1) : 0
}

/** `docker stats --no-stream --format '{{json .}}'` lines, joined with `docker ps` images. Heaviest by CPU. */
export function parseDockerStats(out: string, images: Map<string, string> = new Map()): HostContainer[] {
  const list: HostContainer[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line) as Record<string, string>
      const id = j.ID ?? j.Container ?? ''
      list.push({
        id,
        name: j.Name ?? id,
        image: images.get(id.slice(0, 12)) ?? '',
        cpu: parseFloat(j.CPUPerc ?? '') || 0,
        memPct: parseFloat(j.MemPerc ?? '') || 0,
        memBytes: sizeOf((j.MemUsage ?? '').split('/')[0] ?? ''),
      })
    } catch {
      // A line that is not JSON (a warning): skip.
    }
  }
  return list.sort((a, b) => b.cpu - a.cpu)
}

// ── Worktrees: discovery, classification, safety ────────────────────────────

/** One entry of `git worktree list --porcelain`. `branch` null for a detached (or bare) one. */
export type GitWorktreeEntry = { path: string; head: string | null; branch: string | null }

/** `git -C <repo> worktree list --porcelain`: blocks separated by a blank line, one `worktree <path>` each. */
export function parseWorktreeList(out: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let cur: GitWorktreeEntry | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur)
      cur = { path: line.slice('worktree '.length).trim(), head: null, branch: null }
    } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length).trim()
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
  }
  if (cur) entries.push(cur)
  return entries
}

/** `lsof -a -d cwd -Fpn`: one `p<pid>` line followed by one `n<cwd>` line per process. Only the cwd matters here. */
export function parseLsofCwds(out: string): string[] {
  return out
    .split('\n')
    .filter((l) => l.startsWith('n'))
    .map((l) => l.slice(1))
}

/** Whether some process sits in `path`, or in a folder under it. */
export function isInUse(path: string, cwds: string[]): boolean {
  return cwds.some((c) => c === path || c.startsWith(`${path}/`))
}

/**
 * How a worktree not under workspaces/.worktrees/<project>/ is still named: under the repository itself
 * (e.g. a Claude Code sub-agent's `.claude/worktrees/agent-*`), or by its own basename as a last resort.
 */
export function worktreeName(path: string, repo: { name: string; path: string }, worktreesRoot: string): string {
  const groupPrefix = `${join(worktreesRoot, repo.name)}/`
  if (path.startsWith(groupPrefix)) return path.slice(groupPrefix.length)
  const repoPrefix = `${repo.path}/`
  if (path.startsWith(repoPrefix)) return path.slice(repoPrefix.length)
  return basename(path)
}

/** The command offered to remove a worktree yourself: always scoped with -C (works from any cwd), never forced. */
export const removeCommand = (path: string): string => `git -C "${path}" worktree remove "${path}"`

/** A priest who may own a worktree (directly, or as the base name of one of its sub-agents): live or gone to nirvana. */
export type OwnerCandidate = { sessionId: string; path: string; note: string | null; title: string; alive: boolean; working: boolean }

/** Every priest who could own a worktree: live sessions (their own cwd) and archived ones (their worktree kept, see `Sessions.archivedWorktrees`). */
export function ownerCandidates(
  sessions: Pick<SessionSummary, 'id' | 'cwd' | 'note' | 'title' | 'status'>[],
  nirvana: HostNirvanaWorktree[],
): OwnerCandidate[] {
  return [
    ...sessions.filter((s): s is typeof s & { cwd: string } => !!s.cwd).map((s) => ({ sessionId: s.id, path: s.cwd, note: s.note, title: s.title, alive: true, working: s.status === 'working' })),
    ...nirvana.map((n) => ({ sessionId: n.id, path: n.path, note: n.note, title: n.title, alive: false, working: false })),
  ]
}

const toOwner = (c: OwnerCandidate): NonNullable<HostWorktree['owner']> => ({ sessionId: c.sessionId, note: c.note, title: c.title, alive: c.alive, working: c.working })

/**
 * What a worktree is: `priest` when a live session works right there; `subagent` when it was made for one
 * (nested under an owner's `.claude/worktrees/`, or named after an owner's worktree plus a `-` suffix, in
 * the same folder — the owner can be live or gone to nirvana); `orphan` otherwise, even when its path
 * matches a nirvana entry directly (that case keeps the plain nirvana naming, see `suggest`).
 */
export function classifyWorktree(path: string, candidates: OwnerCandidate[]): { kind: HostWorktree['kind']; owner: HostWorktree['owner'] } {
  if (candidates.some((c) => c.alive && c.path === path)) return { kind: 'priest', owner: null }
  const nested = candidates.find((c) => path.startsWith(`${c.path}/.claude/worktrees/`))
  if (nested) return { kind: 'subagent', owner: toOwner(nested) }
  const parent = dirname(path)
  const base = basename(path)
  const prefixed = candidates.find((c) => dirname(c.path) === parent && base.startsWith(`${basename(c.path)}-`))
  if (prefixed) return { kind: 'subagent', owner: toOwner(prefixed) }
  return { kind: 'orphan', owner: null }
}

const plural = (n: number, word: string, pluralWord = `${word}s`) => (n > 1 ? pluralWord : word)

/** Safe to delete: never a priest's own worktree, and only once clean, fully pushed, unused, and its owner (if any) idle. */
export function removableInfo(
  kind: HostWorktree['kind'],
  facts: { dirty: number; unpushed: number; inUse: boolean },
  owner: HostWorktree['owner'],
  where: { checked: boolean; external: boolean } = { checked: true, external: false },
): { removable: boolean; blocker: string | null } {
  if (kind === 'priest') return { removable: false, blocker: "c'est le worktree d'un prêtre vivant : envoie-le au nirvana" }
  // Not checked on disk yet: zero changes would only mean « not looked », never « safe ».
  if (!where.checked) return { removable: false, blocker: 'vérification en cours' }
  // Made outside Sangha (Kiat Operator under ~/.kiat-operator, scripts under /tmp…) and claimed by no priest: another
  // tool may rely on it, so Sangha never calls it safe to delete.
  if (where.external && !owner) return { removable: false, blocker: 'créé hors de Sangha (Kiat Operator, script…) : vérifie qui s’en sert avant' }
  if (facts.dirty > 0) return { removable: false, blocker: `${facts.dirty} ${plural(facts.dirty, 'fichier')} ${plural(facts.dirty, 'modifié', 'modifiés')}` }
  if (facts.unpushed > 0) return { removable: false, blocker: `${facts.unpushed} ${plural(facts.unpushed, 'commit')} jamais ${plural(facts.unpushed, 'poussé', 'poussés')}` }
  if (facts.inUse) return { removable: false, blocker: 'un process tourne dedans' }
  if (owner?.working) return { removable: false, blocker: `son prêtre « ${owner.note ?? owner.title} » travaille encore` }
  return { removable: true, blocker: null }
}

/** Cache of a worktree's Haiku comment, keyed by path and HEAD sha: a fresh commit asks again, nothing else does. */
export class WorktreeCommentCache {
  private cache = new Map<string, string>()

  constructor(private summarize: (entries: WorktreeCommentInput[]) => Promise<Record<string, string>>) {}

  /** The cached comment for a worktree at this exact HEAD, or null until one has been written. */
  of(path: string, headSha: string | null): string | null {
    return headSha ? this.cache.get(cacheKey(path, headSha)) ?? null : null
  }

  /** Asks about every entry not yet cached for its HEAD, one batched call; a failure leaves them uncached (retried next refresh). */
  async refresh(entries: (WorktreeCommentInput & { headSha: string | null })[]) {
    const todo = entries.filter((e): e is WorktreeCommentInput & { headSha: string } => !!e.headSha && !this.cache.has(cacheKey(e.path, e.headSha)))
    if (!todo.length) return
    const result = await this.summarize(todo).catch(() => ({}) as Record<string, string>)
    for (const e of todo) if (result[e.path]) this.cache.set(cacheKey(e.path, e.headSha), result[e.path]!)
  }
}

const cacheKey = (path: string, sha: string) => `${path}@${sha}`

/** A worktree's own safety facts and the little context a comment is written from. */
type WorktreeFacts = { dirty: number; unpushed: number; headSha: string | null; branch: string | null; commits: string[] }

// ── Levels ──────────────────────────────────────────────────────────────────

type Thresholds = { warn: number; red: number }
export const THRESHOLDS: Record<HostMetricKey, Thresholds> = {
  cpu: { warn: 0.75, red: 0.9 },
  memory: { warn: 0.88, red: 0.95 },
  swap: { warn: 0.5, red: 0.8 },
  disk: { warn: 0.85, red: 0.95 },
}

export const levelOf = (value: number, t: Thresholds): HostLevel => (value >= t.red ? 'red' : value >= t.warn ? 'warn' : 'ok')

const worst = (levels: HostLevel[]): HostLevel => (levels.includes('red') ? 'red' : levels.includes('warn') ? 'warn' : 'ok')

/** A raw reading: each metric's fill (0..1), level and wording. */
export type Reading = Record<HostMetricKey, { value: number; level: HostLevel; detail: string }>

/**
 * How long each metric has stayed red. One calm sample does not reset it (a spike of the other way is noise):
 * it takes two in a row.
 */
export class RedTracker {
  private since = new Map<HostMetricKey, number>()
  private calm = new Map<HostMetricKey, number>()

  update(key: HostMetricKey, level: HostLevel, now: number): number | null {
    if (level === 'red') {
      this.calm.delete(key)
      if (!this.since.has(key)) this.since.set(key, now)
    } else if (this.since.has(key)) {
      const n = (this.calm.get(key) ?? 0) + 1
      if (n >= 2) {
        this.since.delete(key)
        this.calm.delete(key)
      } else this.calm.set(key, n)
    }
    return this.since.get(key) ?? null
  }
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/** An archived session that once worked in a worktree: enough to name it when it is now orphaned, or to own a sub-agent of his. */
export type HostNirvanaWorktree = { id: string; path: string; title: string; note: string | null; archivedAt: number }

export type SuggestInput = {
  metrics: HostMetric[]
  now: number
  processes: HostProcess[]
  containers: HostContainer[] | null
  worktrees: HostWorktree[]
  sessions: Pick<SessionSummary, 'id' | 'title' | 'status' | 'external'>[]
  /** Archived sessions, to name an orphan worktree after who left it behind (see `disk:orphan:`). */
  nirvana?: HostNirvanaWorktree[]
}

/** Shortens a title kept to the word boundary, for a priest named beside his note. */
function shorten(s: string, max = 24): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const i = cut.lastIndexOf(' ')
  return `${(i > 0 ? cut.slice(0, i) : cut).trimEnd()}…`
}

/** How a priest is named in a suggestion: his own note first (how you call him), his title alongside, shortened. */
function namePriest(note: string | null, title: string): string {
  return note ? `« ${note} » (${shorten(title)})` : `« ${title} »`
}

const dateFr = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })

/** What to do about each metric red for longer than RED_AFTER_MS. Sangha only suggests: you run the commands. */
export function suggest({ metrics, now, processes, containers, worktrees, sessions, nirvana = [] }: SuggestInput): HostSuggestion[] {
  const out: HostSuggestion[] = []
  const long = (key: HostMetricKey) => {
    const m = metrics.find((x) => x.key === key)
    return m?.redSince != null && now - m.redSince >= RED_AFTER_MS
  }
  const minutes = (key: HostMetricKey) => Math.round((now - metrics.find((x) => x.key === key)!.redSince!) / 60_000)
  const working = sessions.filter((s) => s.status === 'working' && !s.external)
  const topContainer = (by: 'cpu' | 'memBytes') => [...(containers ?? [])].sort((a, b) => b[by] - a[by])[0]

  if (long('cpu')) {
    const c = topContainer('cpu')
    const p = processes[0]
    if (c && c.cpu >= 50)
      out.push({
        id: `cpu:container:${c.name}`,
        metric: 'cpu',
        title: `CPU saturé depuis ${minutes('cpu')} min : le conteneur ${c.name} prend ${Math.round(c.cpu)} %`,
        detail: 'Arrête-le (ou la stack qui le contient) le temps que la machine respire ; il redémarrera avec docker start ou docker compose up.',
        command: `docker stop ${c.name}`,
      })
    else if (p)
      out.push({
        id: `cpu:process:${p.command}`,
        metric: 'cpu',
        title: `CPU saturé depuis ${minutes('cpu')} min : ${p.command} prend ${Math.round(p.cpu)} %`,
        detail: 'Le processus le plus gourmand. Vérifie qu’il n’est pas bloqué en boucle avant de l’arrêter.',
        command: `kill ${p.pid}`,
      })
    if (working.length >= 3)
      out.push({
        id: 'cpu:priests',
        metric: 'cpu',
        title: `${working.length} prêtres travaillent en même temps`,
        detail: 'Leurs builds et tests se marchent dessus. Interromps ceux qui peuvent attendre et relance-les un par un.',
      })
  }

  if (long('memory') || long('swap')) {
    const key: HostMetricKey = long('memory') ? 'memory' : 'swap'
    const what = key === 'memory' ? 'Mémoire saturée' : 'Swap saturé'
    const c = topContainer('memBytes')
    const p = [...processes].sort((a, b) => b.rssBytes - a.rssBytes)[0]
    if (c && c.memBytes >= GB)
      out.push({
        id: `${key}:container:${c.name}`,
        metric: key,
        title: `${what} depuis ${minutes(key)} min : le conteneur ${c.name} occupe ${bytes(c.memBytes)}`,
        detail: 'Arrête les stacks Docker dont tu n’as pas besoin maintenant ; la machine ne swappera plus pour elles.',
        command: `docker stop ${c.name}`,
      })
    else if (p)
      out.push({
        id: `${key}:process:${p.command}`,
        metric: key,
        title: `${what} depuis ${minutes(key)} min : ${p.command} occupe ${bytes(p.rssBytes)}`,
        detail: 'Le processus qui tient le plus de mémoire parmi les plus actifs. Ferme-le ou redémarre-le s’il fuit.',
        command: `kill ${p.pid}`,
      })
    const idle = sessions.filter((s) => (s.status === 'idle' || s.status === 'waiting') && !s.external)
    if (idle.length >= 4)
      out.push({
        id: `${key}:idle-priests`,
        metric: key,
        title: `${idle.length} prêtres attendent sans rien faire`,
        detail: 'Chacun garde son process Claude ouvert. Congédie ceux dont le travail est fini.',
      })
  }

  if (long('disk')) {
    // Heaviest worktree of a priest who is not working: dismissing him frees it (Sangha checks nothing is lost first).
    const idle = worktrees.find((w) => w.sessionId && w.status !== 'working')
    if (idle)
      out.push({
        id: `disk:worktree:${idle.path}`,
        metric: 'disk',
        title: `Disque plein depuis ${minutes('disk')} min : le worktree de ${namePriest(idle.sessionNote, idle.sessionTitle ?? '')} pèse ${bytes(idle.bytes)}`,
        detail: 'Congédier ce prêtre supprime son worktree (Sangha refuse si du travail serait perdu).',
        sessionId: idle.sessionId!,
      })
    // Only ever a worktree Sangha knows is safe to delete: never a priest's own, and never one with anything to lose.
    const removable = worktrees.find((w) => w.removable)
    if (removable) {
      let who: string
      if (removable.kind === 'subagent' && removable.owner) {
        const ownerName = removable.owner.note ? `« ${removable.owner.note} »` : `« ${removable.owner.title} »`
        who = `un worktree de sous-agent de ${ownerName}${removable.owner.alive ? '' : ' (parti au nirvana)'}`
      } else {
        const left = nirvana.find((n) => n.path === removable.path)
        who = left ? `${namePriest(left.note, left.title)}, parti au nirvana le ${dateFr(left.archivedAt)}` : `${removable.project}/${removable.name}`
      }
      out.push({
        id: `disk:orphan:${removable.path}`,
        metric: 'disk',
        title: `Worktree sans prêtre : ${who} (${bytes(removable.bytes)})`,
        detail: 'Plus aucun prêtre n’y travaille. Vérifie qu’il n’y reste rien à garder, puis retire-le toi-même.',
        command: removable.removeCommand,
      })
    }
    if (containers)
      out.push({
        id: 'disk:docker',
        metric: 'disk',
        title: 'Images, volumes et caches Docker',
        detail: 'Regarde ce que Docker garde sur le disque ; le prune efface les images et caches inutilisés (à lancer toi-même, en connaissance de cause).',
        command: 'docker system df && docker system prune',
      })
  }
  return out
}

// ── Monitor ─────────────────────────────────────────────────────────────────

type CpuTimes = { idle: number; total: number }
const cpuTimes = (): CpuTimes =>
  cpus().reduce(
    (a, c) => {
      const t = c.times
      return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq }
    },
    { idle: 0, total: 0 },
  )

/**
 * Samples the machine Sangha runs on (CPU, memory, swap, the disk of workspaces/, Docker, worktrees) every
 * 10 s, keeps the last half hour, and suggests what to do when something stays red for 5 minutes.
 */
export class HostMonitor {
  report: HostReport | null = null
  private listeners = new Set<(r: HostReport) => void>()
  private timer: NodeJS.Timeout | null = null
  private lastCpu = cpuTimes()
  private history: HostSample[] = []
  private red = new RedTracker()
  private discovered: { path: string; project: string; name: string }[] = []
  private sizes = new Map<string, number>()
  private facts = new Map<string, WorktreeFacts>()
  private inUseCwds: string[] = []
  private sizedAt: number | null = null
  private sizing = false
  private comments = new WorktreeCommentCache(worktreeComments)
  private readonly inContainer = existsSync('/.dockerenv')

  constructor(
    private workspacesDir: string,
    private sessions: () => SessionSummary[],
    /** Archived sessions, so an orphan worktree can be named after who left it behind (see `suggest`), or own a sub-agent of his. */
    private nirvana: () => HostNirvanaWorktree[] = () => [],
    /** Whether the quota reserve holds every priest right now: Haiku comments on worktrees wait their turn like any other (see `Sessions.blocked`). */
    private reserveBlocked: () => boolean = () => false,
    /** Every project that is a git repository: name and root, to discover every worktree it has (see `Projects.repos`). */
    private projectRepos: () => { name: string; path: string }[] = () => [],
  ) {}

  start() {
    const tick = () => this.sample().catch((e) => console.error('host monitor:', e))
    void tick()
    this.timer = setInterval(tick, SAMPLE_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  subscribe(fn: (r: HostReport) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private cpu(): number {
    const now = cpuTimes()
    const total = now.total - this.lastCpu.total
    const busy = total - (now.idle - this.lastCpu.idle)
    this.lastCpu = now
    return total > 0 ? Math.min(1, Math.max(0, busy / total)) : 0
  }

  /** Memory and swap: on macOS the kernel's own pressure level says best whether memory is short. */
  private async memory(): Promise<Pick<Reading, 'memory' | 'swap'>> {
    const ram = totalmem()
    if (platform() === 'darwin') {
      const [vm, swapOut, pressure] = await Promise.all([run('vm_stat', []), run('sysctl', ['-n', 'vm.swapusage']), run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])])
      const available = vm ? parseVmStat(vm) : null
      const used = available == null ? 0 : Math.max(0, ram - available) / ram
      const p = Number(pressure?.trim())
      const memLevel: HostLevel = p >= 4 ? 'red' : p >= 2 ? 'warn' : p === 1 ? 'ok' : levelOf(used, THRESHOLDS.memory)
      const swap = swapOut ? parseSwapUsage(swapOut) : null
      // macOS grows its swap as needed: weigh what is swapped against the RAM, not against the swap's current size.
      const swapValue = swap ? Math.min(1, swap.used / ram) : 0
      return {
        memory: { value: used, level: memLevel, detail: `${bytes(ram * used)} / ${bytes(ram)}${p >= 2 ? ` · pression ${p >= 4 ? 'critique' : 'élevée'}` : ''}` },
        swap: { value: swapValue, level: levelOf(swapValue, { warn: 0.25, red: 0.5 }), detail: swap ? `${bytes(swap.used)} swappés` : 'inconnu' },
      }
    }
    const info = existsSync('/proc/meminfo') ? parseMeminfo(readFileSync('/proc/meminfo', 'utf8')) : null
    if (!info) return { memory: { value: 0, level: 'ok', detail: 'inconnu' }, swap: { value: 0, level: 'ok', detail: 'inconnu' } }
    const used = 1 - info.available / info.total
    const swapUsed = info.swapTotal - info.swapFree
    const swapValue = info.swapTotal > 0 ? swapUsed / info.swapTotal : 0
    return {
      memory: { value: used, level: levelOf(used, THRESHOLDS.memory), detail: `${bytes(info.total - info.available)} / ${bytes(info.total)}` },
      swap: { value: swapValue, level: levelOf(swapValue, THRESHOLDS.swap), detail: info.swapTotal > 0 ? `${bytes(swapUsed)} / ${bytes(info.swapTotal)}` : 'pas de swap' },
    }
  }

  private async disk(): Promise<Reading['disk']> {
    try {
      const s = await statfs(this.workspacesDir)
      const total = s.blocks * s.bsize
      const free = s.bavail * s.bsize
      const value = total > 0 ? 1 - free / total : 0
      // A big disk can be 95 % full and still roomy; a few gigabytes left is tight whatever the size.
      const level = free < 5 * GB ? 'red' : free < 15 * GB ? worst([levelOf(value, THRESHOLDS.disk), 'warn']) : levelOf(value, THRESHOLDS.disk)
      return { value, level, detail: `${bytes(free)} libres sur ${bytes(total)}` }
    } catch {
      return { value: 0, level: 'ok', detail: 'inconnu' }
    }
  }

  private async docker(): Promise<HostContainer[] | null> {
    const [stats, ps] = await Promise.all([
      run('docker', ['stats', '--no-stream', '--format', '{{json .}}'], 15_000),
      run('docker', ['ps', '--format', '{{.ID}}\t{{.Image}}']),
    ])
    if (stats == null) return null
    const images = new Map((ps ?? '').split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]))
    return parseDockerStats(stats, images)
  }

  /** Every worktree of every project repo, wherever git keeps it (not just workspaces/.worktrees/): the main checkout is skipped. */
  private async discoverWorktrees(): Promise<{ path: string; project: string; name: string }[]> {
    const root = join(this.workspacesDir, '.worktrees')
    const out: { path: string; project: string; name: string }[] = []
    for (const repo of this.projectRepos()) {
      const porcelain = await run('git', ['-C', repo.path, 'worktree', 'list', '--porcelain'])
      if (!porcelain) continue
      for (const e of parseWorktreeList(porcelain)) {
        if (e.path === repo.path) continue // the main checkout itself
        out.push({ path: e.path, project: repo.name, name: worktreeName(e.path, repo, root) })
      }
    }
    return out
  }

  /** Dirty/unpushed/branch/commits of one worktree: cheap git calls, run together with its size. */
  private async gitFacts(path: string): Promise<WorktreeFacts> {
    const [status, unpushedOut, head, branch, log] = await Promise.all([
      run('git', ['-C', path, 'status', '--porcelain']),
      run('git', ['-C', path, 'rev-list', '--count', 'HEAD', '--not', '--remotes']),
      run('git', ['-C', path, 'rev-parse', 'HEAD']),
      run('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']),
      run('git', ['-C', path, 'log', '-3', '--pretty=%s']),
    ])
    return {
      dirty: status ? status.split('\n').filter(Boolean).length : 0,
      unpushed: Number(unpushedOut?.trim()) || 0,
      headSha: head?.trim() || null,
      branch: branch?.trim() || null,
      commits: log ? log.split('\n').filter(Boolean) : [],
    }
  }

  /**
   * Every worktree of every project (not just workspaces/.worktrees/), sized with du and read for its safety
   * facts every few minutes: it is slow. One `lsof` call for all of them tells which are in use.
   */
  private async refreshWorktrees() {
    if (this.sizing || (this.sizedAt && Date.now() - this.sizedAt < SIZE_MS)) return
    this.sizing = true
    try {
      const discovered = await this.discoverWorktrees()
      const sizes = new Map<string, number>()
      const facts = new Map<string, WorktreeFacts>()
      for (const w of discovered) {
        const [sizeOut, f] = await Promise.all([run('du', ['-sk', w.path], 60_000), this.gitFacts(w.path)])
        sizes.set(w.path, Number(sizeOut?.split('\t')[0] ?? 0) * 1024)
        facts.set(w.path, f)
      }
      const lsofOut = await run('lsof', ['-a', '-d', 'cwd', '-Fpn'])
      this.inUseCwds = lsofOut ? parseLsofCwds(lsofOut) : []
      this.discovered = discovered
      this.sizes = sizes
      this.facts = facts
      this.sizedAt = Date.now()
      if (!this.reserveBlocked()) void this.refreshComments(discovered, facts)
    } finally {
      this.sizing = false
    }
  }

  /** One batched Haiku call for every worktree whose HEAD has no comment cached yet (see `WorktreeCommentCache`). */
  private async refreshComments(discovered: { path: string; project: string; name: string }[], facts: Map<string, WorktreeFacts>) {
    const candidates = ownerCandidates(this.sessions(), this.nirvana())
    const entries = discovered.map((w) => {
      const f = facts.get(w.path)
      const { owner } = classifyWorktree(w.path, candidates)
      return {
        path: w.path,
        name: `${w.project}/${w.name}`,
        branch: f?.branch ?? null,
        commits: f?.commits ?? [],
        dirty: f?.dirty ?? 0,
        unpushed: f?.unpushed ?? 0,
        owner: owner ? (owner.note ?? owner.title) : null,
        headSha: f?.headSha ?? null,
      }
    })
    await this.comments.refresh(entries).catch((e) => console.error('host monitor: worktree comments', e))
  }

  private mapWorktrees(sessions: SessionSummary[]): HostWorktree[] {
    const candidates = ownerCandidates(sessions, this.nirvana())
    return this.discovered
      .map((w) => {
        const s = sessions.find((x) => x.cwd === w.path)
        const checked = this.facts.get(w.path)
        const facts = checked ?? { dirty: 0, unpushed: 0, headSha: null, branch: null, commits: [] }
        const { kind, owner } = classifyWorktree(w.path, candidates)
        const inUse = isInUse(w.path, this.inUseCwds)
        // Sangha's own: under its workspaces, or a Claude Code sub-agent worktree (`.claude/worktrees/`) inside a repo.
        const external = !w.path.startsWith(this.workspacesDir + '/') && !w.path.includes('/.claude/worktrees/')
        const { removable, blocker } = removableInfo(kind, { dirty: facts.dirty, unpushed: facts.unpushed, inUse }, owner, { checked: !!checked, external })
        return {
          path: w.path,
          project: w.project,
          name: w.name,
          bytes: this.sizes.get(w.path) ?? 0,
          sessionId: s?.id ?? null,
          sessionTitle: s?.title ?? null,
          sessionNote: s?.note ?? null,
          status: s?.status ?? null,
          kind,
          owner,
          dirty: facts.dirty,
          unpushed: facts.unpushed,
          inUse,
          removable,
          blocker,
          removeCommand: removeCommand(w.path),
          comment: this.comments.of(w.path, facts.headSha),
        }
      })
      .sort((a, b) => b.bytes - a.bytes)
  }

  private async sample() {
    const now = Date.now()
    void this.refreshWorktrees()
    const cpu = this.cpu()
    const [mem, disk, ps, containers] = await Promise.all([this.memory(), this.disk(), run('ps', ['-Ao', 'pid=,pcpu=,rss=,comm=']), this.docker()])
    const reading: Reading = {
      cpu: { value: cpu, level: levelOf(cpu, THRESHOLDS.cpu), detail: `${Math.round(cpu * 100)} % de ${cpus().length} cœurs` },
      ...mem,
      disk,
    }
    const labels: Record<HostMetricKey, string> = { cpu: 'CPU', memory: 'Mémoire', swap: 'Swap', disk: 'Disque' }
    const metrics: HostMetric[] = (Object.keys(labels) as HostMetricKey[]).map((key) => ({
      key,
      label: labels[key],
      ...reading[key],
      redSince: this.red.update(key, reading[key].level, now),
    }))
    this.history.push({ at: now, cpu, memory: mem.memory.value, swap: mem.swap.value, disk: disk.value })
    if (this.history.length > HISTORY) this.history.shift()

    const sessions = this.sessions()
    const processes = ps ? parsePs(ps) : []
    const worktrees = this.mapWorktrees(sessions)
    this.report = {
      at: now,
      hostname: hostname(),
      platform: platform(),
      cores: cpus().length,
      inContainer: this.inContainer,
      level: worst(metrics.map((m) => m.level)),
      metrics,
      history: [...this.history],
      processes,
      containers,
      worktrees,
      worktreesSizedAt: this.sizedAt,
      redAfterMs: RED_AFTER_MS,
      suggestions: suggest({ metrics, now, processes, containers, worktrees, sessions, nirvana: this.nirvana() }),
    }
    for (const fn of this.listeners) fn(this.report)
  }
}
