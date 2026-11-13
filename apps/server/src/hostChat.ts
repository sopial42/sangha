import { query } from '@anthropic-ai/claude-agent-sdk'
import type { HostChatTurn, HostReport, HostSuggestion } from '@sangha/shared'
import { bytes } from './host'

const MODEL = process.env.SANGHA_HOST_MODEL ?? 'sonnet'

const SYSTEM = `You help a developer understand and handle an alert on their machine (a Mac or a Linux box) running
Docker stacks, git worktrees and Claude Code agents (Sangha's sessions, each in its own worktree).
You get the alert (a suggestion), the machine's current state and the conversation. Answer their last question
in English, short and concrete: a few sentences or a short list, with commands in \`code\` blocks when needed.
You run nothing yourself. For any command that deletes something (rm, prune, git worktree remove, kill…),
say clearly what will be lost and suggest checking first (size, contents, git status). If you don't know,
say which command would tell.`

/** The machine as the model reads it: metrics, heaviest processes, containers, worktrees. */
function describe(r: HostReport): string {
  const lines = [`Machine ${r.hostname} (${r.platform}, ${r.cores} cores${r.inContainer ? ', Sangha inside a container' : ''})`]
  for (const m of r.metrics) lines.push(`- ${m.label}: ${Math.round(m.value * 100)}% (${m.detail}), ${m.level}${m.redSince ? `, red for ${Math.round((r.at - m.redSince) / 60_000)} min` : ''}`)
  lines.push('Heaviest processes:', ...r.processes.map((p) => `- ${p.command} (pid ${p.pid}): ${Math.round(p.cpu)}% CPU, ${bytes(p.rssBytes)}`))
  if (r.containers) lines.push('Docker containers:', ...(r.containers.length ? r.containers.map((c) => `- ${c.name} (${c.image}): ${Math.round(c.cpu)}% CPU, ${bytes(c.memBytes)}`) : ['- none']))
  else lines.push('Docker: unavailable')
  lines.push(
    'Worktrees (heaviest first):',
    ...r.worktrees.slice(0, 10).map((w) => `- ${w.path}: ${bytes(w.bytes)}, ${w.sessionTitle ? `session "${w.sessionTitle}" (${w.status})` : 'no session'}`),
  )
  return lines.join('\n')
}

/** Answer a question about one suggestion, with the machine's current state. One-shot, tool-less, on the plan quota. */
export async function askAboutSuggestion(suggestion: HostSuggestion, report: HostReport | null, chat: HostChatTurn[]): Promise<string> {
  const prompt = [
    `Alert: ${suggestion.title}\n${suggestion.detail}${suggestion.command ? `\nSuggested command: ${suggestion.command}` : ''}`,
    report ? `Current state:\n${describe(report)}` : 'Current state: unknown',
    'Conversation:',
    ...chat.slice(-12).map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text}`),
  ].join('\n\n')
  const env = { ...process.env } as Record<string, string>
  delete env.ANTHROPIC_API_KEY
  const q = query({
    prompt,
    options: { model: MODEL, systemPrompt: SYSTEM, tools: [], settingSources: [], plugins: [], persistSession: false, maxTurns: 1, env },
  })
  for await (const m of q) {
    if (m.type !== 'result') continue
    if (m.subtype === 'success' && m.result.trim()) return m.result.trim()
    break
  }
  throw new Error('No answer from the model. Try again.')
}
