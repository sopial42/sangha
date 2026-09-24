import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CostReport } from '@sangha/shared'
import { readNewLines } from './files'

// What a session would cost at API list prices ($ per million tokens), though it runs on the plan quota.
// Cache writes cost 1.25× input (5 min) or 2× (1 h); cache reads are listed per model.
type Price = { input: number; output: number; read: number }
const PRICES: [RegExp, Price][] = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, read: 0.25 }],
  [/fable|mythos/, { input: 10, output: 50, read: 1 }],
  [/opus-5-5/, { input: 4, output: 20, read: 0.2 }],
  [/opus-4-[01]|opus-4-2025|opus-4$/, { input: 15, output: 75, read: 1.5 }],
  [/opus/, { input: 5, output: 25, read: 0.5 }],
  [/sonnet-5/, { input: 2, output: 10, read: 0.2 }],
  [/sonnet/, { input: 3, output: 15, read: 0.3 }],
  [/haiku-3/, { input: 0.8, output: 4, read: 0.08 }],
  [/haiku/, { input: 1, output: 5, read: 0.1 }],
]

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  speed?: string
}

/** Dollar price of one reply, from its model and token usage (0 when the model is unknown). */
export function priceOf(model: string, u: Usage): number {
  const p = PRICES.find(([re]) => re.test(model))?.[1]
  if (!p) return 0
  const write = u.cache_creation_input_tokens ?? 0
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write
  const usd =
    (u.input_tokens ?? 0) * p.input +
    (u.output_tokens ?? 0) * p.output +
    (u.cache_read_input_tokens ?? 0) * p.read +
    w5m * p.input * 1.25 +
    w1h * p.input * 2
  return ((u.speed === 'fast' ? 2 : 1) * usd) / 1_000_000
}

type FileTally = { offset: number; usd: number; seen: Set<string> }

/**
 * Running cost of Claude Code transcripts, read incrementally (only what was appended since last time).
 * A reply spans several lines sharing one message id and usage: each id counts once.
 */
export class CostMeter {
  private files = new Map<string, FileTally>()

  /** Cost of a session: its transcript plus its novices' (subagents/*.jsonl next to it). */
  session(transcript: string): number {
    const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
    const novices = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)) : []
    return [transcript, ...novices].reduce((sum, f) => sum + this.file(f), 0)
  }

  private file(path: string): number {
    if (!existsSync(path)) return 0
    let t = this.files.get(path)
    if (!t) this.files.set(path, (t = { offset: 0, usd: 0, seen: new Set() }))
    if (statSync(path).size <= t.offset) return t.usd
    const { lines, offset } = readNewLines(path, t.offset)
    t.offset = offset
    for (const line of lines) {
      if (!line.includes('"usage"')) continue
      try {
        const l = JSON.parse(line) as { type?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Usage } }
        const m = l.message
        if (l.type !== 'assistant' || !m?.usage || !m.model) continue
        const key = m.id ?? l.requestId
        if (key) {
          if (t.seen.has(key)) continue
          t.seen.add(key)
        }
        t.usd += priceOf(m.model, m.usage)
      } catch {
        // a malformed line: skip it
      }
    }
    return t.usd
  }
}

/** A session's own cost (its transcript alone, never a predecessor's carried-over cost), for the report. */
export type CostSession = { id: string; project: string; title: string; createdAt: number; cost: number }

const monthOf = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** What the monastery has cost at API prices since monitoring began, bucketed by month. */
export function buildCostReport(sessions: CostSession[]): CostReport {
  const byMonth = new Map<string, CostSession[]>()
  for (const s of sessions) {
    const list = byMonth.get(monthOf(s.createdAt))
    if (list) list.push(s)
    else byMonth.set(monthOf(s.createdAt), [s])
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, list]) => {
      const byProject = new Map<string, { sessions: number; cost: number }>()
      for (const s of list) {
        const p = byProject.get(s.project) ?? { sessions: 0, cost: 0 }
        p.sessions += 1
        p.cost += s.cost
        byProject.set(s.project, p)
      }
      const record = list.reduce<CostSession | null>((best, s) => (s.cost > 0 && (!best || s.cost > best.cost) ? s : best), null)
      return {
        month,
        sessions: list.length,
        cost: list.reduce((sum, s) => sum + s.cost, 0),
        projects: [...byProject.entries()].map(([project, p]) => ({ project, ...p })).sort((a, b) => b.cost - a.cost),
        record: record && { id: record.id, title: record.title, project: record.project, cost: record.cost },
      }
    })
  return {
    total: sessions.reduce((sum, s) => sum + s.cost, 0),
    sessions: sessions.length,
    since: sessions.length ? Math.min(...sessions.map((s) => s.createdAt)) : null,
    months,
  }
}
