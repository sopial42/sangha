import type { BackgroundScript } from '@sangha/shared'

/** A raw background task as the SDK reports it (see normalize.ts). */
export type BackgroundTask = { id: string; type: string; description: string }

// Subagents run in the background too, but are already shown as novices.
const AGENT_TYPE = 'local_agent'

/**
 * Pure tracking of the scripts a priest has running in the background, from one `background` event to
 * the next: `since` is kept for an id already seen, a summary already written is carried over, agents are
 * excluded (novices show them already), and anything missing from the latest set has finished. Oldest first.
 */
export function trackScripts(prev: BackgroundScript[], tasks: BackgroundTask[], now: number): BackgroundScript[] {
  const prevById = new Map(prev.map((s) => [s.id, s]))
  return tasks
    .filter((t) => t.type !== AGENT_TYPE)
    .map((t) => {
      const p = prevById.get(t.id)
      return { id: t.id, kind: t.type, command: t.description, summary: p?.summary ?? null, since: p?.since ?? now }
    })
    .sort((a, b) => a.since - b.since)
}

const MAX_WORDS = 12
const QUOTES = /^[«"'“”»]+|[«"'“”»]+$/g

/** Trims quotes a small model may have added, collapses it to one line, and caps it to twelve words. */
export function cleanScriptSummary(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim().replace(QUOTES, '').trim()
  const words = oneLine.split(' ')
  return words.length > MAX_WORDS ? words.slice(0, MAX_WORDS).join(' ') + '…' : oneLine
}

/** What is given to the small model: the command it is asked about, in the session it runs in. */
export function scriptPrompt(command: string, title: string): string {
  return `SESSION : ${title}\nCOMMANDE : ${command}`
}

type SummarizeFn = (command: string, title: string) => Promise<string | null>

/**
 * Per-session, per-task cache of Haiku's one-sentence summary of a background script, read synchronously
 * by summaries. Written in the background, one call at a time; a failure is kept as "no summary" and is
 * never retried on its own — mirrors PullRequests in pulls.ts.
 */
export class ScriptSummaries {
  private cache = new Map<string, string>()
  // Every (session, task) ever asked about, successful or not: a failure is not retried on its own.
  private attempted = new Set<string>()
  private queue: { sessionId: string; taskId: string; command: string; title: string }[] = []
  private draining: Promise<void> | null = null

  constructor(
    /** Called once a summary is written, so the session can be re-broadcast. */
    private onReady: (sessionId: string, taskId: string, summary: string) => void,
    private summarize: SummarizeFn,
  ) {}

  /** The cached summary for a session's script, or null when there is none (or none written yet). */
  of(sessionId: string, taskId: string): string | null {
    return this.cache.get(key(sessionId, taskId)) ?? null
  }

  /** Asks for a script's summary, once per (session, task): later calls for the same one are no-ops. */
  request(sessionId: string, taskId: string, command: string, title: string) {
    const k = key(sessionId, taskId)
    if (this.attempted.has(k)) return
    this.attempted.add(k)
    this.queue.push({ sessionId, taskId, command, title })
    void this.drain()
  }

  /** Resolves once every queued script has been asked about (for tests: awaits the current drain to finish). */
  async drained() {
    await this.draining
  }

  private drain(): Promise<void> {
    if (!this.draining) this.draining = this.runQueue().finally(() => (this.draining = null))
    return this.draining
  }

  private async runQueue() {
    for (let item = this.queue.shift(); item; item = this.queue.shift()) {
      const summary = await this.summarize(item.command, item.title).catch(() => null)
      if (!summary) continue
      this.cache.set(key(item.sessionId, item.taskId), summary)
      this.onReady(item.sessionId, item.taskId, summary)
    }
  }
}

const key = (sessionId: string, taskId: string) => `${sessionId}:${taskId}`
