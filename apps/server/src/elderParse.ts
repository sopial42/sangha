import type { ElderSettings } from '@sangha/shared'

export type ElderTopicDraft = { id?: string; scope: string; title: string; detail: string; evidence: string[] }
export type ElderAnswer = { report: string; topics: ElderTopicDraft[] }

const MAX_NEW_TOPICS = 5

function scopeAllowed(scope: string, levels: ElderSettings['levels'], projects: string[]): boolean {
  if (scope === 'manual') return levels.manual
  if (scope === 'sangha') return levels.sangha
  const m = /^project:(.+)$/.exec(scope)
  return !!m && levels.project && projects.includes(m[1]!)
}

/** Unknown ids are treated as new topics (title required), disallowed scopes are rejected, at most 5 new topics, empty fields are rejected. */
export function parseElderResponse(raw: unknown, knownTopicIds: Set<string>, levels: ElderSettings['levels'], projects: string[]): ElderAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.report !== 'string' || !rec.report.trim()) return null
  const rawTopics = Array.isArray(rec.topics) ? rec.topics : []
  let newCount = 0
  const topics: ElderTopicDraft[] = []
  for (const t of rawTopics) {
    const tr = t as Record<string, unknown> | null
    if (!tr || typeof tr !== 'object') continue
    const title = typeof tr.title === 'string' ? tr.title.trim() : ''
    const detail = typeof tr.detail === 'string' ? tr.detail.trim() : ''
    const scope = typeof tr.scope === 'string' ? tr.scope : ''
    if (!title || !detail || !scope) continue
    if (!scopeAllowed(scope, levels, projects)) continue
    const evidence = Array.isArray(tr.evidence) ? tr.evidence.filter((e): e is string => typeof e === 'string') : []
    const id = typeof tr.id === 'string' && knownTopicIds.has(tr.id) ? tr.id : undefined
    if (!id) {
      if (newCount >= MAX_NEW_TOPICS) continue
      newCount++
    }
    topics.push({ ...(id && { id }), scope, title, detail, evidence })
  }
  return { report: rec.report.trim(), topics }
}
