import { useEffect, useRef, useState } from 'react'
import type { CostReport } from '@sangha/shared'
import { api } from './api'
import { formatCost } from './priests'
import { useApp } from './store'

const THROTTLE_MS = 30_000

/**
 * Top bar, beside the brand: what every session would have cost at API prices, since monitoring
 * began (they actually run on the plan). Loads once, then refreshes whenever a session changes,
 * throttled so a busy courtyard does not refetch on every tiny update.
 */
export function CostChip({ onOpen }: { onOpen: () => void }) {
  const sessionsVersion = useApp((s) => s.sessionsVersion)
  const [report, setReport] = useState<CostReport | null>(null)
  const lastFetch = useRef(0)

  useEffect(() => {
    const now = Date.now()
    if (lastFetch.current && now - lastFetch.current < THROTTLE_MS) return
    lastFetch.current = now
    api.costs().then(setReport, () => undefined)
    // Refetch on load, then again each time a session changes (throttled above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsVersion])

  if (!report || report.total < 0.01) return null

  const since = report.since ? new Date(report.since).toLocaleDateString('fr', { day: 'numeric', month: 'long', year: 'numeric' }) : null

  return (
    <button
      className="cost-chip"
      onClick={onOpen}
      title={`Ce qu'auraient coûté toutes tes sessions au prix de l'API${since ? `, depuis le ${since}` : ''}. Elles tournent sur ton abonnement.`}
    >
      {formatCost(report.total)}
    </button>
  )
}
