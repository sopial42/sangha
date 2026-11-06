import type { ElderSettings } from '@sangha/shared'
import type { Store } from './db'

export type ElderContext = { text: string; newItems: number }

function feedbackBlock(store: Store, sessionId: string | undefined, maxItems = 50): { text: string; count: number } {
  const rows = store.pendingFeedback().filter((f) => !sessionId || f.sessionId === sessionId).slice(0, maxItems)
  if (!rows.length) return { text: '', count: 0 }
  const lines = rows.map((f) => `- [${f.id}] ${f.rating ?? 'sans note'}${f.comment ? ` : ${f.comment}` : ''}\n  ${f.excerpt}`)
  return { text: lines.join('\n'), count: rows.length }
}

function projectBlock(store: Store, projects: string[], since: number): { text: string; count: number } {
  if (!projects.length) return { text: '', count: 0 }
  const rows = store.archivedSessions().filter((r) => projects.includes(r.project) && (r.archivedAt ?? 0) >= since)
  const withSummary = rows
    .map((r) => ({ r, summary: store.note<{ summary: string }>(r.id, 'nirvana')?.value.summary ?? null }))
    .filter((x): x is { r: (typeof rows)[number]; summary: string } => !!x.summary)
  if (!withSummary.length) return { text: '', count: 0 }
  return { text: withSummary.map(({ r, summary }) => `- (${r.project}) ${r.title} : ${summary}`).join('\n'), count: withSummary.length }
}

function sanghaBlock(store: Store, since: number): { text: string; hasNew: boolean } {
  const stats = store.elderSanghaStats(since)
  const lines: string[] = []
  const errs = Object.entries(stats.toolErrorsByServer)
  if (errs.length) lines.push(`Échecs d'outils MCP : ${errs.map(([s, n]) => `${s} (${n})`).join(', ')}`)
  if (stats.sessionErrors) lines.push(`Erreurs de session : ${stats.sessionErrors}`)
  if (stats.interruptions) lines.push(`Sessions interrompues : ${stats.interruptions}`)
  if (stats.renewals) lines.push(`Renouvellements (session neuve) : ${stats.renewals}`)
  if (stats.shepherded) lines.push(`Sessions confiées à Bouddha : ${stats.shepherded}`)
  if (stats.costUsd > 0) lines.push(`Coût total (équivalent API) : ${stats.costUsd.toFixed(2)} $`)
  return { text: lines.join('\n'), hasNew: lines.length > 0 }
}

function memoryBlock(store: Store): string {
  const topics = store.elderTopics()
  const open = topics.filter((t) => t.status === 'proposed' || t.status === 'accepted')
  const rejected = topics.filter((t) => t.status === 'rejected')
  const lines: string[] = []
  if (open.length) lines.push(`Sujets ouverts :\n${open.map((t) => `- [${t.id}] (${t.status}) ${t.title}`).join('\n')}`)
  if (rejected.length) lines.push(`Déjà rejetés, ne pas reproposer :\n${rejected.map((t) => `- ${t.title}`).join('\n')}`)
  return lines.join('\n\n')
}

function fit(blocks: { label: string; text: string }[], max: number): string {
  let budget = max
  const parts: string[] = []
  for (const b of blocks) {
    if (!b.text || budget <= 0) continue
    const take = b.text.length > budget ? `${b.text.slice(0, Math.max(0, budget - 1))}…` : b.text
    parts.push(`## ${b.label}\n${take}`)
    budget -= take.length
  }
  return parts.join('\n\n')
}

/** Le contexte envoyé au modèle, par blocs actifs selon le niveau, tronqué à `maxInputChars` (retours en priorité).
 *  `sessionId` : un passage de fin de conversation, restreint à cette session (ses retours, rien d'autre). */
export function buildContext(settings: ElderSettings, since: number, store: Store, sessionId?: string): ElderContext {
  const feedback = settings.levels.manual || sessionId ? feedbackBlock(store, sessionId) : { text: '', count: 0 }
  const project = !sessionId && settings.levels.project ? projectBlock(store, settings.projects, since) : { text: '', count: 0 }
  const sangha = !sessionId && settings.levels.sangha ? sanghaBlock(store, since) : { text: '', hasNew: false }
  const memory = memoryBlock(store)

  const text = fit(
    [
      { label: 'Retours', text: feedback.text },
      { label: 'Projets suivis', text: project.text },
      { label: 'Sangha', text: sangha.text },
      { label: 'Mémoire', text: memory },
    ],
    settings.maxInputChars,
  )
  const newItems = feedback.count + project.count + (sangha.hasNew ? 1 : 0)
  return { text, newItems }
}
