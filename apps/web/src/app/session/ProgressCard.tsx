import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Cancel01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import type { SessionSummary } from '@sangha/shared'
import { MdInline } from '@/Md'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Progress = { goal: string; state: string; next: string }

// Closed cards, per session, remembered across reloads.
const CLOSED_KEY = 'sangha.progressClosed'
const closedCards = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/**
 * Where the session stands. Shown at once from the recap already known (the one on its board card); a fuller
 * point from Haiku replaces it quietly when ready.
 */
export function ProgressCard({ session }: { session: SessionSummary }) {
  const [data, setData] = useState<Progress | null>(null)
  const [loading, setLoading] = useState(false)
  const [closed, setClosed] = useState(() => closedCards().includes(session.id))
  useEffect(() => setClosed(closedCards().includes(session.id)), [session.id])
  const toggle = (close: boolean) => {
    const others = closedCards().filter((id) => id !== session.id)
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(close ? [...others, session.id].slice(-200) : others))
    } catch {
      // Storage unavailable: the card still closes for this visit.
    }
    setClosed(close)
  }

  const load = (fresh = false) => {
    setLoading(true)
    fetch(`/api/sessions/${session.id}/progress${fresh ? '?fresh=1' : ''}`)
      .then((r) => r.json() as Promise<{ progress: Progress | null }>)
      .then((r) => r.progress && setData(r.progress))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

  // On open, and again each time it stops working.
  useEffect(() => {
    if (!closed) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.status === 'working', closed])

  const shown: Progress | null =
    data ??
    (session.recap
      ? { goal: session.title, state: session.recap.done, next: session.recap.next }
      : session.doing
        ? { goal: session.title, state: session.doing, next: 'Working on it.' }
        : null)

  if (closed)
    return (
      <Button variant="ghost" size="sm" onClick={() => toggle(false)} className="text-muted-foreground">
        Show progress
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.8} data-icon="inline-end" />
      </Button>
    )

  return (
    <section aria-label="Progress" aria-live="polite" aria-busy={loading} className="relative flex flex-col gap-2 rounded-xl border bg-card p-4 pr-20">
      <div className="absolute top-2 right-2 flex gap-1">
        <Button variant="ghost" size="icon-sm" onClick={() => load(true)} disabled={loading} aria-label="Refresh progress" title="Refresh progress">
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => toggle(true)} aria-label="Close" title="Close">
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} />
        </Button>
      </div>
      {!shown && <p className="text-small text-muted-foreground">{loading ? 'Catching up on this session…' : 'No progress point for this session yet.'}</p>}
      {shown && (
        <>
          {shown.goal !== session.title && <Line label="Task" text={shown.goal} />}
          <Line label="Done" text={shown.state} />
          <Line label="Next" text={shown.next} />
        </>
      )}
    </section>
  )
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <p className="flex gap-3 text-small">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0">
        <MdInline text={text} />
      </span>
    </p>
  )
}
