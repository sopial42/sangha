import type { AdvisorSettings } from '@sangha/shared'
import type { Store } from './db'

export type AdvisorContext = { text: string; newItems: number; feedbackIds: string[] }

/**
 * Only whole feedback items that fit in `maxChars` count as included: an item the truncation would cut in
 * half must never be marked processed (`Advisor.runPass` only marks `feedbackIds`), or we would lose feedback
 * the Advisor never actually read.
 */
function feedbackBlock(store: Store, sessionId: string | undefined, maxChars: number, maxItems = 50): { text: string; ids: string[] } {
  const rows = store.pendingFeedback().filter((f) => !sessionId || f.sessionId === sessionId).slice(0, maxItems)
  const lines: string[] = []
  const ids: string[] = []
  let used = 0
  for (const f of rows) {
    const line = `- [${f.id}] ${f.rating ?? 'no rating'}${f.comment ? ` : ${f.comment}` : ''}\n  ${f.excerpt}`
    const extra = line.length + (lines.length ? 1 : 0) // +1 for the joining '\n'
    if (used + extra > maxChars) break
    lines.push(line)
    ids.push(f.id)
    used += extra
  }
  return { text: lines.join('\n'), ids }
}

function projectBlock(store: Store, projects: string[], since: number): { text: string; count: number } {
  if (!projects.length) return { text: '', count: 0 }
  const rows = store.archivedSessions().filter((r) => projects.includes(r.project) && (r.archivedAt ?? 0) >= since)
  const withSummary = rows
    .map((r) => ({ r, summary: store.note<{ summary: string }>(r.id, 'closed')?.value.summary ?? null }))
    .filter((x): x is { r: (typeof rows)[number]; summary: string } => !!x.summary)
  if (!withSummary.length) return { text: '', count: 0 }
  return { text: withSummary.map(({ r, summary }) => `- (${r.project}) ${r.title}: ${summary}`).join('\n'), count: withSummary.length }
}

function sanghaBlock(store: Store, since: number): { text: string; hasNew: boolean } {
  const stats = store.advisorSanghaStats(since)
  const lines: string[] = []
  const errs = Object.entries(stats.toolErrorsByServer)
  if (errs.length) lines.push(`MCP tool failures: ${errs.map(([s, n]) => `${s} (${n})`).join(', ')}`)
  if (stats.sessionErrors) lines.push(`Session errors: ${stats.sessionErrors}`)
  if (stats.interruptions) lines.push(`Interrupted sessions: ${stats.interruptions}`)
  if (stats.renewals) lines.push(`Fresh starts (new session): ${stats.renewals}`)
  if (stats.handedOff) lines.push(`Sessions handed to the orchestrator for a fresh start: ${stats.handedOff}`)
  if (stats.costUsd > 0) lines.push(`Total cost (API equivalent): $${stats.costUsd.toFixed(2)}`)
  return { text: lines.join('\n'), hasNew: lines.length > 0 }
}

function memoryBlock(store: Store): string {
  const topics = store.advisorTopics()
  const open = topics.filter((t) => t.status === 'proposed' || t.status === 'accepted')
  const rejected = topics.filter((t) => t.status === 'rejected')
  const lines: string[] = []
  if (open.length) lines.push(`Open topics:\n${open.map((t) => `- [${t.id}] (${t.status}) ${t.title}`).join('\n')}`)
  if (rejected.length) lines.push(`Already rejected, do not propose again:\n${rejected.map((t) => `- ${t.title}`).join('\n')}`)
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

/** The context sent to the model, in blocks enabled by level, truncated to `maxInputChars` (feedback first).
 *  `sessionId`: an end-of-conversation pass, limited to that session (its feedback, nothing else). The
 *  "manual" level fully governs feedback, even for an end-of-conversation pass: that pass exists only for
 *  feedback, so when the level is off there is nothing to send. */
export function buildContext(settings: AdvisorSettings, since: number, store: Store, sessionId?: string): AdvisorContext {
  const feedback = settings.levels.manual ? feedbackBlock(store, sessionId, settings.maxInputChars) : { text: '', ids: [] }
  const project = !sessionId && settings.levels.project ? projectBlock(store, settings.projects, since) : { text: '', count: 0 }
  const sangha = !sessionId && settings.levels.sangha ? sanghaBlock(store, since) : { text: '', hasNew: false }
  const memory = memoryBlock(store)

  const text = fit(
    [
      { label: 'Feedback', text: feedback.text },
      { label: 'Followed projects', text: project.text },
      { label: 'Sangha', text: sangha.text },
      { label: 'Memory', text: memory },
    ],
    settings.maxInputChars,
  )
  const newItems = feedback.ids.length + project.count + (sangha.hasNew ? 1 : 0)
  return { text, newItems, feedbackIds: feedback.ids }
}
