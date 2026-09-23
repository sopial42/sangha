import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { MonasteryEvent, Quota, QuotaWindow } from '@sangha/shared'

// Tools the main agent uses to summon a subagent. Monks are announced by the
// task_started system message instead, so these tool_use blocks are not shown.
const SUMMON_TOOLS = new Set(['Agent', 'Task'])

/**
 * Stateful translator from raw Agent SDK messages to MonasteryEvents.
 * One instance per session. Messages it does not care about produce [].
 */
export class Normalizer {
  // task_id -> monkId (the summoning tool_use id, which is what parent_tool_use_id points at)
  private monkByTask = new Map<string, string>()

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
        return [{ t: 'monk.done', monkId, status: m.status, summary: m.summary }]
      }
      default:
        return []
    }
  }

  private assistant(content: unknown, parent: string | null): MonasteryEvent[] {
    if (!Array.isArray(content)) return []
    const out: MonasteryEvent[] = []
    for (const block of content as Array<{ type: string; text?: string; name?: string; input?: unknown }>) {
      if (block.type === 'text' && block.text) {
        out.push(parent ? { t: 'monk.text', monkId: parent, text: block.text } : { t: 'buddha.text', text: block.text })
      } else if (block.type === 'tool_use' && block.name) {
        if (!parent && SUMMON_TOOLS.has(block.name)) continue
        const summary = summarizeInput(block.input)
        out.push(parent ? { t: 'monk.tool', monkId: parent, tool: block.name, summary } : { t: 'buddha.tool', tool: block.name, summary })
      }
    }
    return out
  }
}

const ERROR_HINTS: Partial<Record<string, string>> = {
  authentication_failed: 'Claude n’est pas connecté. Lance `make token`, colle CLAUDE_CODE_OAUTH_TOKEN dans .env puis `make up`.',
  oauth_org_not_allowed: 'Ce compte Claude n’est pas autorisé à utiliser Claude Code.',
  rate_limit: 'Quota de l’abonnement atteint : les moines méditent jusqu’à la prochaine fenêtre.',
  billing_error: 'Problème de facturation sur le compte Claude.',
  overloaded: 'Claude est surchargé, réessaie dans un instant.',
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
