import { query } from '@anthropic-ai/claude-agent-sdk'
import type { HostChatTurn, HostReport, HostSuggestion } from '@sangha/shared'
import { bytes } from './host'

const MODEL = process.env.SANGHA_HOST_MODEL ?? 'sonnet'

const SYSTEM = `Tu aides un développeur à comprendre et traiter une alerte sur sa machine (un Mac ou un Linux) où tournent
des stacks Docker, des worktrees git et des agents Claude Code (les « prêtres » de Sangha, chacun dans son worktree).
Tu reçois l'alerte (une suggestion), l'état actuel de la machine et la conversation. Réponds à sa dernière question,
en français, court et concret : quelques phrases ou une petite liste, des commandes en blocs \`code\` s'il en faut.
Tu n'exécutes rien toi-même. Pour toute commande qui supprime quelque chose (rm, prune, git worktree remove, kill…),
dis clairement ce qui sera perdu et propose d'abord de vérifier (taille, contenu, statut git). Si tu ne sais pas,
dis quelle commande donnerait l'information.`

/** The machine as the model reads it: metrics, heaviest processes, containers, worktrees. */
function describe(r: HostReport): string {
  const lines = [`Machine ${r.hostname} (${r.platform}, ${r.cores} cœurs${r.inContainer ? ', Sangha dans un conteneur' : ''})`]
  for (const m of r.metrics) lines.push(`- ${m.label} : ${Math.round(m.value * 100)} % (${m.detail}), ${m.level}${m.redSince ? `, rouge depuis ${Math.round((r.at - m.redSince) / 60_000)} min` : ''}`)
  lines.push('Processus les plus lourds :', ...r.processes.map((p) => `- ${p.command} (pid ${p.pid}) : ${Math.round(p.cpu)} % CPU, ${bytes(p.rssBytes)}`))
  if (r.containers) lines.push('Conteneurs Docker :', ...(r.containers.length ? r.containers.map((c) => `- ${c.name} (${c.image}) : ${Math.round(c.cpu)} % CPU, ${bytes(c.memBytes)}`) : ['- aucun']))
  else lines.push('Docker : indisponible')
  lines.push(
    'Worktrees (les plus lourds) :',
    ...r.worktrees.slice(0, 10).map((w) => `- ${w.path} : ${bytes(w.bytes)}, ${w.sessionTitle ? `prêtre « ${w.sessionTitle} » (${w.status})` : 'aucun prêtre'}`),
  )
  return lines.join('\n')
}

/** Answer a question about one suggestion, with the machine's current state. One-shot, tool-less, on the plan quota. */
export async function askAboutSuggestion(suggestion: HostSuggestion, report: HostReport | null, chat: HostChatTurn[]): Promise<string> {
  const prompt = [
    `Alerte : ${suggestion.title}\n${suggestion.detail}${suggestion.command ? `\nCommande suggérée : ${suggestion.command}` : ''}`,
    report ? `État actuel :\n${describe(report)}` : 'État actuel : inconnu',
    'Conversation :',
    ...chat.slice(-12).map((t) => `${t.role === 'user' ? 'Lui' : 'Toi'} : ${t.text}`),
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
  throw new Error('Pas de réponse du modèle, réessaie.')
}
