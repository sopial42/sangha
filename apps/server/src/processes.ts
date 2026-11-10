import { basename } from 'node:path'

export type Proc = { pid: number; ppid: number; command: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** `ps -axo pid=,ppid=,command=` output, by pid. */
export function parseProcs(out: string): Map<number, Proc> {
  const procs = new Map<number, Proc>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! })
  }
  return procs
}

export const isClaude = (command: string) => basename(command.trim().split(/\s+/)[0] ?? '') === 'claude'

/** The Claude Code session a `claude` command line resumes or names (`--resume <id>`, `--resume=<id>`, `-r`, `--session-id`). */
export function sessionIdOf(command: string): string | null {
  const args = command.trim().split(/\s+/)
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i]!.split('=', 2) as [string, string | undefined]
    if (flag !== '--resume' && flag !== '-r' && flag !== '--session-id') continue
    const id = inline ?? args[i + 1] ?? ''
    if (UUID.test(id)) return id
  }
  return null
}

/** The nearest `claude` process above this one (through the shells in between), if any. */
export function claudeAncestor(pid: number, procs: Map<number, Proc>): Proc | null {
  const seen = new Set<number>()
  for (let p = procs.get(procs.get(pid)?.ppid ?? -1); p && !seen.has(p.pid); p = procs.get(p.ppid)) {
    seen.add(p.pid)
    if (isClaude(p.command)) return p
  }
  return null
}
