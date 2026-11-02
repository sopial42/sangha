import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { cpus, hostname, platform, totalmem } from 'node:os'
import { join } from 'node:path'
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

export type SuggestInput = {
  metrics: HostMetric[]
  now: number
  processes: HostProcess[]
  containers: HostContainer[] | null
  worktrees: HostWorktree[]
  sessions: Pick<SessionSummary, 'id' | 'title' | 'status' | 'external'>[]
}

/** What to do about each metric red for longer than RED_AFTER_MS. Sangha only suggests: you run the commands. */
export function suggest({ metrics, now, processes, containers, worktrees, sessions }: SuggestInput): HostSuggestion[] {
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
        title: `Disque plein depuis ${minutes('disk')} min : le worktree de « ${idle.sessionTitle} » pèse ${bytes(idle.bytes)}`,
        detail: 'Congédier ce prêtre supprime son worktree (Sangha refuse si du travail serait perdu).',
        sessionId: idle.sessionId!,
      })
    const orphan = worktrees.find((w) => !w.sessionId)
    if (orphan)
      out.push({
        id: `disk:orphan:${orphan.path}`,
        metric: 'disk',
        title: `Worktree sans prêtre : ${orphan.project}/${orphan.name} (${bytes(orphan.bytes)})`,
        detail: 'Plus aucun prêtre n’y travaille. Vérifie qu’il n’y reste rien à garder, puis retire-le toi-même.',
        command: `git -C "${orphan.path}" status --short && git worktree remove "${orphan.path}"`,
      })
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
  private worktrees: HostWorktree[] = []
  private sizes = new Map<string, number>()
  private sizedAt: number | null = null
  private sizing = false
  private readonly inContainer = existsSync('/.dockerenv')

  constructor(
    private workspacesDir: string,
    private sessions: () => SessionSummary[],
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

  /** Worktrees Sangha made (workspaces/.worktrees/<project>/<name>), sized with du every few minutes: it is slow. */
  private async sizeWorktrees() {
    if (this.sizing || (this.sizedAt && Date.now() - this.sizedAt < SIZE_MS)) return
    this.sizing = true
    try {
      const root = join(this.workspacesDir, '.worktrees')
      const dirs: string[] = []
      for (const project of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
        if (!project.isDirectory()) continue
        // A worktree is one level down, except names with a slash (sangha/lead-…): two levels.
        for (const d of readdirSync(join(root, project.name), { withFileTypes: true })) {
          if (!d.isDirectory()) continue
          const path = join(root, project.name, d.name)
          if (existsSync(join(path, '.git'))) dirs.push(path)
          else for (const sub of readdirSync(path, { withFileTypes: true })) if (sub.isDirectory() && existsSync(join(path, sub.name, '.git'))) dirs.push(join(path, sub.name))
        }
      }
      const sizes = new Map<string, number>()
      for (const dir of dirs) {
        const out = await run('du', ['-sk', dir], 60_000)
        sizes.set(dir, Number(out?.split('\t')[0] ?? 0) * 1024)
      }
      this.sizes = sizes
      this.sizedAt = Date.now()
    } finally {
      this.sizing = false
    }
  }

  private mapWorktrees(sessions: SessionSummary[]): HostWorktree[] {
    const root = join(this.workspacesDir, '.worktrees')
    return [...this.sizes]
      .map(([path, size]) => {
        const s = sessions.find((x) => x.cwd === path)
        const [project, ...rest] = path.slice(root.length + 1).split('/')
        return { path, project: project ?? '', name: rest.join('/'), bytes: size, sessionId: s?.id ?? null, sessionTitle: s?.title ?? null, status: s?.status ?? null }
      })
      .sort((a, b) => b.bytes - a.bytes)
  }

  private async sample() {
    const now = Date.now()
    void this.sizeWorktrees()
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
      suggestions: suggest({ metrics, now, processes, containers, worktrees, sessions }),
    }
    for (const fn of this.listeners) fn(this.report)
  }
}
