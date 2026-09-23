import type { MonasteryEvent } from '@sangha/shared'
import { summarizeInput } from './normalize'

// Claude Code transcripts (~/.claude/projects/<dir>/<session>.jsonl): one JSON object per line.
type Block = { type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown }
type Line = {
  type?: string
  entrypoint?: string
  lastPrompt?: string
  agentSetting?: string
  agentName?: string
  aiTitle?: string
  content?: unknown
  /** A message you sent while the agent was busy: Claude Code queues it, then attaches it here. */
  attachment?: { type?: string; prompt?: unknown }
  isSidechain?: boolean
  isMeta?: boolean
  cwd?: string
  gitBranch?: string
  timestamp?: string
  message?: { role?: string; content?: string | Block[] }
}

const SUMMON_TOOLS = new Set(['Agent', 'Task'])
// Harness chatter (slash commands, reminders, notifications) rather than something the user typed.
const isChatter = (text: string) => /^\s*</.test(text) || text.startsWith('Caveat:')

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((c: Block) => (c.type === 'text' ? (c.text ?? '') : ''))
          .join('\n')
          .trim()
      : ''

export function parseLine(raw: string): Line | null {
  try {
    return JSON.parse(raw) as Line
  } catch {
    return null
  }
}

/**
 * Translates a transcript into MonasteryEvents so an outside session reads like a Sangha one.
 * Stateful: remembers which tool_use ids summoned novices.
 */
export class TranscriptReader {
  private summons = new Set<string>()

  push(line: Line): MonasteryEvent[] {
    if (line.isSidechain) return []
    // A background novice reports through a <task-notification>, wherever the harness queued it.
    const note = notification(typeof line.message?.content === 'string' ? line.message.content : typeof line.content === 'string' ? line.content : '')
    if (note && this.summons.has(note.toolUseId)) {
      this.summons.delete(note.toolUseId)
      return [{ t: 'monk.done', monkId: note.toolUseId, status: note.status, summary: note.summary }]
    }
    // A message queued while the agent was busy (typed in the terminal, or relayed from Sangha).
    if (line.attachment?.type === 'queued_command' && typeof line.attachment.prompt === 'string') {
      const prompt = line.attachment.prompt
      const text = peerMessage(prompt) ?? (isChatter(prompt) ? null : prompt)
      return text ? [{ t: 'user.message', text }] : []
    }
    const content = line.message?.content
    // A message from another session (your replies sent from Sangha): Claude Code marks it meta.
    const peer = line.type === 'user' && typeof content === 'string' ? peerMessage(content) : null
    if (peer) return [{ t: 'user.message', text: peer }]
    if (line.isMeta) return []
    if (line.type === 'user') {
      if (typeof content === 'string') return isChatter(content) ? [] : [{ t: 'user.message', text: content }]
      if (!Array.isArray(content)) return []
      const out: MonasteryEvent[] = []
      for (const b of content) {
        if (b.type === 'text' && b.text && !isChatter(b.text)) out.push({ t: 'user.message', text: b.text })
        if (b.type === 'tool_result' && b.tool_use_id && this.summons.has(b.tool_use_id)) {
          const text = textOf(b.content)
          // A background novice answers "launched" at once; his real report comes later.
          if (!/running in the background|launched successfully|async agent/i.test(text)) {
            this.summons.delete(b.tool_use_id)
            out.push({ t: 'monk.done', monkId: b.tool_use_id, status: 'completed', summary: text.slice(0, 4000) })
          }
        }
      }
      return out
    }
    if (line.type === 'assistant' && Array.isArray(content)) {
      const out: MonasteryEvent[] = []
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) out.push({ t: 'buddha.text', text: b.text })
        if (b.type !== 'tool_use' || !b.name) continue
        if (SUMMON_TOOLS.has(b.name) && b.id) {
          this.summons.add(b.id)
          out.push({
            t: 'monk.summoned',
            monkId: b.id,
            agentType: String(b.input?.subagent_type ?? 'general-purpose'),
            description: String(b.input?.description ?? ''),
            prompt: String(b.input?.prompt ?? ''),
            depth: 1,
          })
        } else out.push({ t: 'buddha.tool', tool: b.name, summary: summarizeInput(b.input) })
      }
      return out
    }
    return []
  }
}

/**
 * Appended to your text when Sangha relays it to a terminal session, so the peer answers you directly and
 * Sangha stays invisible in the conversation. peerMessage() strips it back off for display.
 */
export const RELAY_NOTE =
  '— Transmis tel quel depuis l’interface de l’utilisateur : c’est lui qui l’a écrit. Réponds-lui directement, comme s’il l’avait tapé ici, sans mentionner ce relais, l’interface ni l’autre session.'

/**
 * A message another session sent through Claude Code's cross-session messaging. Your replies from Sangha
 * come this way: shown as what you wrote; other peers' messages are labelled as such.
 */
export function peerMessage(text: string): string | null {
  const m = /<cross-session-message[^>]*from-name="([^"]*)"[^>]*>\n?([\s\S]*?)\n?<\/cross-session-message>/.exec(text)
  if (!m) return null
  const body = m[2]!.trim()
  // Your reply relayed by Sangha: your text, then the relay note (or, from older versions, a prefix).
  // Found by its opening words: the relay may alter punctuation (’ → ') on the way.
  const note = body.lastIndexOf('\n\n— Transmis tel quel')
  if (note >= 0) return body.slice(0, note).trim()
  const legacy = /^Message de .*?, envoyé depuis Sangha[^:]*:\s*/.exec(body)
  return legacy ? body.slice(legacy[0].length).trim() : `↪ ${m[1]} : ${body}`
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Parse a `<task-notification>` block: which summoning finished, how, and his report. */
export function notification(text: string): { toolUseId: string; status: 'completed' | 'failed' | 'stopped'; summary: string } | null {
  if (!text.includes('<task-notification>')) return null
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim()
  const toolUseId = tag('tool-use-id')
  if (!toolUseId) return null
  const status = tag('status')
  return {
    toolUseId,
    status: status === 'failed' ? 'failed' : status === 'killed' || status === 'stopped' ? 'stopped' : 'completed',
    summary: unescape(tag('result') ?? tag('summary') ?? '').slice(0, 4000),
  }
}

/**
 * How many tokens the session's context weighs: what its latest main-thread reply read
 * (fresh input + cache reads + cache writes).
 */
export function contextTokens(lines: Line[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]! as Line & { message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }
    const u = l.message?.usage
    if (l.type !== 'assistant' || l.isSidechain || !u) continue
    return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  }
  return null
}

/** Last tool a transcript used, from its latest lines. */
export function lastTool(lines: Line[]): { tool: string; summary: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = lines[i]!.message?.content
    if (lines[i]!.type !== 'assistant' || !Array.isArray(c)) continue
    const t = [...c].reverse().find((b) => b.type === 'tool_use' && b.name)
    if (t) return { tool: t.name!, summary: summarizeInput(t.input) }
  }
  return null
}

/** The user's latest request, as Claude Code records it in `last-prompt` lines. */
export function latestPrompt(lines: Line[]): string | null {
  const l = [...lines].reverse().find((x) => x.type === 'last-prompt' && x.lastPrompt)
  const text = l?.lastPrompt?.replace(/^[\s▎>]+/, '').trim()
  return text ? text.split('\n')[0]!.slice(0, 80) : null
}

/** First thing the user asked, as the session's title. */
export function firstPrompt(lines: Line[]): string | null {
  for (const l of lines) {
    if (l.type !== 'user' || l.isMeta || l.isSidechain) continue
    const text = textOf(l.message?.content)
    if (text && !isChatter(text)) return text.split('\n')[0]!.slice(0, 80)
  }
  return null
}

/** Agent the session runs as its main thread (`claude --agent kiat-team-lead`), if any. */
export function mainAgent(lines: Line[]): string | null {
  const l = [...lines].reverse().find((x) => (x.type === 'agent-setting' && x.agentSetting) || (x.type === 'agent-name' && x.agentName))
  return l?.agentSetting ?? l?.agentName ?? null
}

/** Short title Claude Code writes for the session. */
export function aiTitle(lines: Line[]): string | null {
  return [...lines].reverse().find((x) => x.type === 'ai-title' && x.aiTitle)?.aiTitle ?? null
}

export type NoviceLogItem = { kind: 'tool'; tool: string; summary: string } | { kind: 'text'; text: string }

/** A novice's own transcript (subagents/agent-*.jsonl, all sidechain lines): his words and tools. */
export function noviceLog(lines: Line[]): NoviceLogItem[] {
  const out: NoviceLogItem[] = []
  for (const l of lines) {
    const c = l.message?.content
    if (l.type !== 'assistant' || !Array.isArray(c)) continue
    for (const b of c) {
      if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', text: b.text })
      if (b.type === 'tool_use' && b.name) out.push({ kind: 'tool', tool: b.name, summary: summarizeInput(b.input) })
    }
  }
  return out
}
