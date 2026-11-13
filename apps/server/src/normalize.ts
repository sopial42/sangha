import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { MonasteryEvent, Quota, QuotaWindow } from '@sangha/shared'

// Tools the main agent uses to summon a subagent. Subagents are announced by the
// task_started system message instead, so these tool_use blocks are not shown.
const SUMMON_TOOLS = new Set(['Agent', 'Task'])

/**
 * Stateful translator from raw Agent SDK messages to MonasteryEvents.
 * One instance per session. Messages it does not care about produce [].
 */
export class Normalizer {
  // task_id -> monkId (the summoning tool_use id, which is what parent_tool_use_id points at)
  private monkByTask = new Map<string, string>()
  // The reverse of monkByTask: a subagent's own SDK task id, the one `Query.stopTask` expects (never its
  // monkId, which is its summoning tool_use id, a different string entirely).
  private taskByMonk = new Map<string, string>()
  // tool_use id -> what was called and by whom (to link the tool_result that follows, one message later)
  private toolUseNames = new Map<string, { name: string; parent: string | null }>()

  push(m: SDKMessage): MonasteryEvent[] {
    switch (m.type) {
      case 'system':
        return this.system(m)
      case 'stream_event': {
        if (m.parent_tool_use_id) return []
        const e = m.event
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') return [{ t: 'buddha.delta', text: e.delta.text }]
        return []
      }
      case 'assistant':
        if (m.error && !m.parent_tool_use_id) return [{ t: 'error', message: ERROR_HINTS[m.error] ?? `Claude error: ${m.error}` }]
        return this.assistant(m.message.content, m.parent_tool_use_id)
      case 'user':
        return this.toolResults(m)
      case 'result':
        return [
          {
            t: 'turn.done',
            ok: m.subtype === 'success' && !m.is_error,
            costUsdEquiv: m.total_cost_usd,
            durationMs: m.duration_ms,
            usage: {
              inputTokens: m.usage.input_tokens,
              outputTokens: m.usage.output_tokens,
              cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0,
            },
          },
        ]
      case 'rate_limit_event':
        return [{ t: 'quota', quota: toQuota(m.rate_limit_info) }]
      default:
        return []
    }
  }

  private system(m: Extract<SDKMessage, { type: 'system' }>): MonasteryEvent[] {
    switch (m.subtype) {
      case 'init':
        return [
          {
            t: 'session.started',
            model: m.model,
            agents: m.agents ?? [],
            skills: m.skills ?? [],
            plugins: (m.plugins ?? []).filter((p) => p.path !== 'builtin').map((p) => p.name),
            claudeSessionId: m.session_id,
          },
        ]
      case 'task_started': {
        if (m.task_type !== 'local_agent' || m.ambient) return []
        const monkId = m.tool_use_id ?? m.task_id
        this.monkByTask.set(m.task_id, monkId)
        this.taskByMonk.set(monkId, m.task_id)
        return [
          {
            t: 'monk.summoned',
            monkId,
            agentType: m.subagent_type ?? 'general-purpose',
            description: m.description,
            prompt: m.prompt ?? '',
            depth: m.spawn_depth ?? 1,
          },
        ]
      }
      case 'task_progress': {
        const monkId = this.monkByTask.get(m.task_id)
        if (!monkId) return []
        return [{ t: 'monk.progress', monkId, description: m.description, tokens: m.usage.total_tokens, toolUses: m.usage.tool_uses }]
      }
      case 'task_notification': {
        const monkId = this.monkByTask.get(m.task_id)
        if (!monkId) return []
        this.monkByTask.delete(m.task_id)
        this.taskByMonk.delete(monkId)
        return [{ t: 'monk.done', monkId, status: m.status, summary: m.summary }]
      }
      case 'background_tasks_changed':
        return [{ t: 'background', tasks: m.tasks.filter((k) => !k.ambient).map((k) => ({ id: k.task_id, type: k.task_type, description: k.description })) }]
      default:
        return []
    }
  }

  /** A live subagent's own SDK task id, for `Query.stopTask` (interrupting it by its monkId would do nothing). */
  taskIdOfMonk(monkId: string): string | undefined {
    return this.taskByMonk.get(monkId)
  }

  private assistant(content: unknown, parent: string | null): MonasteryEvent[] {
    if (!Array.isArray(content)) return []
    const out: MonasteryEvent[] = []
    for (const block of content as Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>) {
      if (block.type === 'text' && block.text) {
        out.push(parent ? { t: 'monk.text', monkId: parent, text: block.text } : { t: 'buddha.text', text: block.text })
      } else if (block.type === 'tool_use' && block.name) {
        if (block.id) this.toolUseNames.set(block.id, { name: block.name, parent })
        if (!parent && SUMMON_TOOLS.has(block.name)) continue
        const summary = summarizeInput(block.input)
        out.push(parent ? { t: 'monk.tool', monkId: parent, tool: block.name, summary } : { t: 'buddha.tool', tool: block.name, summary })
        // The session's own /loop machinery (never a subagent's: subagents do not drive its autonomy). Store.lastAutonomy
        // reads these to know whether a loop keeps rescheduling itself or died.
        if (!parent && LOOP_TOOLS.has(block.name)) {
          const wake = loopWakeEvent(block.name, block.input)
          if (wake) out.push(wake)
        }
      }
    }
    return out
  }

  private toolResults(m: Extract<SDKMessage, { type: 'user' }>): MonasteryEvent[] {
    const content = m.message.content
    if (!Array.isArray(content)) return []
    const out: MonasteryEvent[] = []
    for (const block of content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue
      const used = this.toolUseNames.get(block.tool_use_id)
      // The tool_use is consumed as soon as its result arrives, failed or not: otherwise the map would grow
      // without bound over a long session (every tool call would leave an entry there forever).
      this.toolUseNames.delete(block.tool_use_id)
      if (!block.is_error || !used || used.parent) continue // only tools from the session's own thread feed the Advisor's Sangha block
      const parts = used.name.split('__')
      if (parts.length < 2 || parts[0] !== 'mcp') continue // not an MCP tool: the Advisor only tracks server failures
      out.push({ t: 'tool.error', tool: used.name, server: parts[1]!, message: toolErrorMessage(block.content) })
    }
    return out
  }
}

// Tools Claude Code's bundled /loop skill drives itself with: ScheduleWakeup each turn when self-paced,
// CronCreate/CronDelete for a fixed interval (see sdk-tools.d.ts for their input shapes).
const LOOP_TOOLS = new Set(['ScheduleWakeup', 'CronCreate', 'CronDelete'])

function loopWakeEvent(tool: string, input: unknown): Extract<MonasteryEvent, { t: 'loop.wake' }> | null {
  const rec = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const now = Date.now()
  if (tool === 'ScheduleWakeup') {
    if (rec.stop === true) return { t: 'loop.wake', nextAt: null, stop: true }
    const delaySeconds = typeof rec.delaySeconds === 'number' ? rec.delaySeconds : null
    return { t: 'loop.wake', nextAt: delaySeconds != null ? now + delaySeconds * 1000 : null, stop: false }
  }
  if (tool === 'CronCreate') {
    const cron = typeof rec.cron === 'string' ? rec.cron : null
    return { t: 'loop.wake', nextAt: cron ? nextCronFire(cron, now) : null, stop: false }
  }
  // CronDelete: removing the recurring job ends that loop (no more fires are coming).
  return { t: 'loop.wake', nextAt: null, stop: true }
}

/**
 * The next time a standard 5-field cron expression ("M H DoM Mon DoW", local time) fires strictly after
 * `from`. Brute-forced minute by minute (cheap for the short, regular intervals `/loop` actually uses,
 * e.g. "* / 5 * * * *") and capped so an expression that rarely matches (e.g. pinned to Feb 29) gives up
 * rather than scanning for years: null rather than an expensive or unbounded search.
 */
export function nextCronFire(cron: string, from: number, maxMinutes = 100_000): number | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minuteField, hourField, domField, monthField, dowField] = fields as [string, string, string, string, string]
  const minutes = parseCronField(minuteField, 0, 59)
  const hours = parseCronField(hourField, 0, 23)
  const doms = parseCronField(domField, 1, 31)
  const months = parseCronField(monthField, 1, 12)
  const dows = parseCronField(dowField, 0, 6)
  if (!minutes || !hours || !doms || !months || !dows) return null
  const domWild = domField === '*'
  const dowWild = dowField === '*'

  const t = new Date(from)
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  for (let i = 0; i < maxMinutes; i++) {
    const dayMatches = domWild && dowWild ? true : domWild ? dows.has(t.getDay()) : dowWild ? doms.has(t.getDate()) : doms.has(t.getDate()) || dows.has(t.getDay())
    if (minutes.has(t.getMinutes()) && hours.has(t.getHours()) && months.has(t.getMonth() + 1) && dayMatches) return t.getTime()
    t.setMinutes(t.getMinutes() + 1)
  }
  return null
}

/** One field of a cron expression ("*", "N", "N,N", "N-N", "* /N", "N-N/N") as the set of values it allows. */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const range = m[1]!
    const step = m[2] ? parseInt(m[2], 10) : 1
    let lo = min
    let hi = max
    if (range !== '*') {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(range)
      if (rangeMatch) {
        lo = parseInt(rangeMatch[1]!, 10)
        hi = parseInt(rangeMatch[2]!, 10)
      } else lo = hi = parseInt(range, 10)
    }
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

const ERROR_HINTS: Partial<Record<string, string>> = {
  authentication_failed: 'Claude is not signed in. Run `make token`, paste CLAUDE_CODE_OAUTH_TOKEN into .env, then run `make up`.',
  oauth_org_not_allowed: 'This Claude account is not allowed to use Claude Code.',
  rate_limit: 'Plan quota reached: sessions are paused until the next window.',
  billing_error: 'Billing problem on the Claude account.',
  overloaded: 'Claude is overloaded, try again in a moment.',
}

const SUMMARY_KEYS = ['description', 'file_path', 'command', 'pattern', 'url', 'skill', 'query', 'path', 'prompt']

export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const rec = input as Record<string, unknown>
  const key = SUMMARY_KEYS.find((k) => typeof rec[k] === 'string')
  const value = key ? (rec[key] as string) : Object.values(rec).find((v) => typeof v === 'string')
  return typeof value === 'string' ? truncate(value.replace(/\s+/g, ' ').trim(), 140) : ''
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function toolErrorMessage(content: unknown): string {
  if (typeof content === 'string') return truncate(content.replace(/\s+/g, ' ').trim(), 200)
  if (Array.isArray(content)) {
    const text = content.find((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')?.text
    if (typeof text === 'string') return truncate(text.replace(/\s+/g, ' ').trim(), 200)
  }
  return 'failed'
}

type RateLimitInfo = Extract<SDKMessage, { type: 'rate_limit_event' }>['rate_limit_info'] & {
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>
}

function toQuota(info: RateLimitInfo): Quota {
  const win = (name: string): QuotaWindow | null => {
    const w = info.unifiedWindows?.[name]
    if (w?.utilization != null) return { utilization: w.utilization, resetsAt: w.resetsAt ?? null }
    // Older CLIs only report the window that triggered the event.
    if (info.rateLimitType === name && info.utilization != null) return { utilization: info.utilization, resetsAt: info.resetsAt ?? null }
    return null
  }
  return { status: info.status, fiveHour: win('five_hour'), sevenDay: win('seven_day') }
}
