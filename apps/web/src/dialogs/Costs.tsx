import { useEffect, useState } from 'react'
import type { CostReport } from '@sangha/shared'
import { api } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { formatCost } from '@/lib/sessions'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What every session would have cost at API prices, since monitoring began, one table per month. */
export function Costs({ onClose }: { onClose: () => void }) {
  const sessions = useApp((s) => s.sessions)
  const [report, setReport] = useState<CostReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void api.costs().then(setReport, (err) => setError(message(err))), [])

  const since = report?.since ? new Date(report.since).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const monthLabel = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <Modal
      size="lg"
      title="Costs"
      description={
        report && report.months.length > 0 ? (
          <>
            <span className="font-medium text-foreground">{formatCost(report.total)}</span> in total at API prices, across {plural(report.sessions, 'session')}
            {since && <> since {since}</>}.
          </>
        ) : (
          'What your sessions would have cost at API prices.'
        )
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-6">
        {!report && !error && (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        )}
        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
        {report && report.months.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No sessions yet</EmptyTitle>
              <EmptyDescription>Costs show up here once you have run a session.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {report?.months.map((m) => {
          const maxProject = Math.max(0.01, ...m.projects.map((p) => p.cost))
          return (
            <section key={m.month} className="flex flex-col gap-2" aria-label={monthLabel(m.month)}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-ui font-medium">{monthLabel(m.month)}</h3>
                <span className="text-small text-muted-foreground tabular-nums">
                  {plural(m.sessions, 'session')} · {formatCost(m.cost)}
                </span>
              </div>
              <Table className="text-small">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-1/3">
                      <span className="sr-only">Share</span>
                    </TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.projects.map((p) => (
                    <TableRow key={p.project}>
                      <TableCell className="max-w-48 truncate font-medium">{p.project}</TableCell>
                      <TableCell>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className="h-full rounded-full bg-stone" style={{ width: `${(p.cost / maxProject) * 100}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{p.sessions}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCost(p.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {m.record && (
                <p className="text-meta text-muted-foreground">
                  Most expensive this month:{' '}
                  {/* The session may have closed since (its cost outlives it): its name only shows while it is still on the board. */}
                  <span className="text-foreground">{sessions[m.record.id]?.note || m.record.title}</span> ({m.record.project}), {formatCost(m.record.cost)}
                </p>
              )}
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
