import { useState } from 'react'
import { modelKey, type SessionSummary } from '@sangha/shared'
import { api } from '@/api'
import { nameOf } from '@/lib/sessions'
import { useApp } from '@/store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * The model the session thinks with, changeable at any time: within Claude (or within OVH) from its next reply on.
 * Switching between Claude and OVH relaunches it on the same conversation, which interrupts a turn in progress
 * (asked first).
 */
export function ModelPick({ session: s }: { session: SessionSummary }) {
  const models = useApp((st) => st.models)
  const [error, setError] = useState<string | null>(null)
  if (!models.length) return null
  const key = modelKey(s.engine, s.model)
  const current = models.some((m) => m.id === key) ? key : null
  const change = (id: string | null) => {
    // '' is a real choice (Claude with the agent's own model): only null means nothing picked.
    if (id == null || id === current) return
    const next = models.find((m) => m.id === id)
    const relaunch = next && next.engine !== (s.engine ?? 'claude')
    if (relaunch && s.status === 'working' && !confirm(`${nameOf(s)}: switching provider relaunches the session and interrupts its current turn. Continue?`)) return
    api.setModel(s.id, id).then(
      () => setError(null),
      (e: Error) => setError(e.message),
    )
  }
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <Select items={models.map((m) => ({ value: m.id, label: m.label }))} value={current} onValueChange={change}>
        <SelectTrigger
          size="sm"
          aria-label="Model for this session"
          title="Model for this session: applies from its next reply (switching provider relaunches it)"
          aria-invalid={error ? true : undefined}
          className="max-w-44 text-small"
        >
          <SelectValue placeholder="Pick a model" />
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="text-right text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
