import { basename } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { RELAY_NOTE } from './transcript'

const MESSENGER_MODEL = process.env.SANGHA_MESSENGER_MODEL ?? 'haiku'

export type Relay = { ok: true; to: string } | { ok: false; error: string }

/**
 * Deliver your reply to a Claude Code session running elsewhere on this machine (a terminal), through
 * Claude Code's own cross-session messaging: a tiny SDK session finds the peer with ListAgents and hands it
 * the text with SendMessage. Your text goes first, as written, followed by RELAY_NOTE so the peer answers
 * you directly. Delivery is automatic when both sides share a permission mode (both bypass here), else it
 * is held for approval in the terminal.
 */
export async function relayToPeer(peer: { cwd: string; startedAt: number }, text: string): Promise<Relay> {
  const env = { ...process.env } as Record<string, string>
  delete env.ANTHROPIC_API_KEY
  const started = new Date(peer.startedAt).toISOString()
  const body = `${text}\n\n${RELAY_NOTE}`
  const prompt = `You are a message relay. Do exactly this and nothing else:
1. Call ListAgents.
2. Pick the peer session whose name starts with "${basename(peer.cwd)}-" (its working folder is ${peer.cwd}; it was started around ${started}). If several match, pick the one whose start time is closest.
3. Call SendMessage once, to that peer, with this exact message (verbatim, do not add or change anything):
<<<MESSAGE
${body}
MESSAGE>>>
4. Reply with only the name you sent it to, or "NOT_FOUND" if no peer matched.`

  const q = query({
    prompt,
    options: {
      model: MESSENGER_MODEL,
      tools: ['ListAgents', 'SendMessage'],
      disallowedTools: ['mcp__*'],
      settingSources: [],
      plugins: [],
      mcpServers: {},
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      maxTurns: 6,
      env,
    },
  })
  let to: string | null = null
  let sendError: string | null = null
  for await (const m of q) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'tool_use' && b.name === 'SendMessage') to = String((b.input as { to?: string }).to ?? '')
    }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      for (const b of m.message.content as Array<{ type: string; is_error?: boolean; content?: unknown }>) {
        if (b.type === 'tool_result' && b.is_error && to) sendError = JSON.stringify(b.content).slice(0, 300)
      }
    }
    if (m.type === 'result') break
  }
  if (!to) return { ok: false, error: 'session introuvable parmi les sessions locales' }
  if (sendError) return { ok: false, error: sendError }
  return { ok: true, to }
}
