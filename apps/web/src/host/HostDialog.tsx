import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { HostMetric, HostSample, HostSuggestion, HostWorktree, SessionSummary } from '@sangha/shared'
import { openSession } from '@/api'
import { ago } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { Modal } from '@/dialogs/Modal'
import { ShellSnippet } from '@/dialogs/Providers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemFooter, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBytes, formatSpan, LEVEL_BG, LEVEL_COLOR, LEVEL_LABEL, LEVEL_TEXT, STATUS_WORD } from './level'
import { SuggestionChat } from './SuggestionChat'

const SEGMENTS = 20

/** A metric's recent history (about 30 min), as a thin inline polyline: no chart lib needed for this. */
export function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null
  const w = 112
  const h = 24
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - Math.min(1, Math.max(0, v)) * (h - 2) - 1).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="shrink-0 opacity-80" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <polyline points={points} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** One metric: a segmented gauge, its detail in words, a sparkline of its history, and how long it's stayed red. */
function Metric({ metric, history }: { metric: HostMetric; history: HostSample[] }) {
  const values = history.map((s) => s[metric.key])
  const pct = Math.round(metric.value * 100)
  const on = Math.round(Math.min(1, Math.max(0, metric.value)) * SEGMENTS)
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-small text-muted-foreground">{metric.label}</span>
        <span className={cn('text-ui font-semibold tabular-nums', LEVEL_TEXT[metric.level])} title={LEVEL_LABEL[metric.level]}>
          {pct}%
        </span>
      </div>
      <div className="flex gap-[3px]" role="meter" aria-label={metric.label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${pct}%, ${LEVEL_LABEL[metric.level]}`}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div key={i} className={cn('h-3 flex-1 rounded-[2px]', i < on ? LEVEL_BG[metric.level] : 'bg-secondary')} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-meta text-muted-foreground" title={metric.detail}>
          {metric.detail}
        </span>
        <Sparkline values={values} tone={LEVEL_COLOR[metric.level]} />
      </div>
      {metric.redSince != null && <p className="text-meta text-danger">Critical for {formatSpan(metric.redSince)}</p>}
    </div>
  )
}

/**
 * The worktree a suggestion is about, when it is one of the disk ones (an idle session's worktree, or an
 * orphan): matched by its id (`disk:worktree:<path>` / `disk:orphan:<path>`), else by its command when
 * it happens to be exactly the worktree's own removal command.
 */
function matchSuggestionWorktree(s: HostSuggestion, worktrees: HostWorktree[]): HostWorktree | undefined {
  const m = /^disk:(?:worktree|orphan):(.+)$/.exec(s.id)
  if (m) return worktrees.find((w) => w.path === m[1])
  return s.command ? worktrees.find((w) => w.removeCommand === s.command) : undefined
}

/** What a worktree is, in a sentence or two by a small model: quiet and in italics, a placeholder while it still thinks. */
function WorktreeComment({ comment }: { comment: string | null }) {
  return <p className="text-small text-muted-foreground italic">{comment ?? 'Haiku is reading this worktree.'}</p>
}

/**
 * Copies a worktree's removal command. Safe to delete: a plain "Copy command". Not: the same command
 * stays one click away, but behind an amber "Copy anyway" whose tooltip names the blocker. The facts are
 * never hidden, only the risk is made visible.
 */
function WorktreeCopyButton({ w }: { w: HostWorktree }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(w.removeCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(!w.removable && 'border-amber/40 text-amber hover:text-amber')}
      onClick={copy}
      title={!w.removable && w.blocker ? w.blocker : undefined}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} data-icon="inline-start" />
      {copied ? 'Copied' : w.removable ? 'Copy command' : 'Copy anyway'}
    </Button>
  )
}

/** A session's name, its note first when it has one, its title alongside. */
function SessionName({ note, title }: { note?: string | null; title: string }) {
  return note ? (
    <>
      <span className="font-medium text-foreground">{note}</span> <span className="text-muted-foreground">({title})</span>
    </>
  ) : (
    <span className="font-medium text-foreground">{title}</span>
  )
}

/**
 * Who a worktree belongs to, named like everywhere else a session is (its name first, its title
 * alongside): a subagent's owner, or the worktree's own session; none when it is an orphan. The name
 * comes from the live store when the session is still on the board (freshest), the report's own copy
 * once it isn't (closed, or the report just hasn't caught up yet).
 */
function WorktreeOwner({ w, sessions }: { w: HostWorktree; sessions: Record<string, Pick<SessionSummary, 'note'>> }) {
  if (w.kind === 'subagent' && w.owner) {
    const note = sessions[w.owner.sessionId]?.note ?? w.owner.note
    return <SessionName note={note} title={w.owner.title} />
  }
  if (w.sessionId) {
    const note = sessions[w.sessionId]?.note ?? w.sessionNote
    return (
      <>
        <SessionName note={note} title={w.sessionTitle ?? ''} />
        {w.status && <span className="text-muted-foreground"> · {STATUS_WORD[w.status]}</span>}
      </>
    )
  }
  return <span className="text-muted-foreground">No session</span>
}

/** The kind badge: what this worktree is, for a subagent one with its owner's name and whether it's still around. */
function worktreeKind(w: HostWorktree): { label: string; orphan: boolean } {
  if (w.kind === 'orphan') return { label: 'Orphan', orphan: true }
  if (w.kind === 'priest') return { label: 'Session', orphan: false }
  const owner = w.owner
  const who = owner ? (owner.note ?? owner.title) : ''
  let label = `Subagent of ${who}`
  if (owner && !owner.alive) label += ' · closed'
  else if (owner?.working) label += ' · working'
  return { label, orphan: false }
}

/** Small safety facts, only the ones that apply: how much is uncommitted, unpushed, or in use. */
function worktreeFacts(w: HostWorktree): string[] {
  const facts: string[] = []
  if (w.dirty > 0) facts.push(`${w.dirty} change${w.dirty > 1 ? 's' : ''}`)
  if (w.unpushed > 0) facts.push(`${w.unpushed} unpushed commit${w.unpushed > 1 ? 's' : ''}`)
  if (w.inUse) facts.push('in use')
  return facts
}

/** One worktree, as a readable row: what it is, whose it is, what a small model makes of it, and whether it's safe to clear. */
function WorktreeRow({ w, sessions }: { w: HostWorktree; sessions: Record<string, Pick<SessionSummary, 'note'>> }) {
  const badge = worktreeKind(w)
  const facts = worktreeFacts(w)
  return (
    <Item variant="outline" className="items-start" role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <span className="min-w-0 truncate font-mono text-small">
            {w.project} / {w.name}
          </span>
          <span className="shrink-0 text-meta font-normal text-muted-foreground tabular-nums">{formatBytes(w.bytes)}</span>
          <Badge variant={badge.orphan ? 'outline' : 'secondary'} className={cn('max-w-60 truncate', badge.orphan && 'border-amber/40 text-amber')}>
            {badge.label}
          </Badge>
        </ItemTitle>
        <div className="text-small">
          <WorktreeOwner w={w} sessions={sessions} />
        </div>
        <WorktreeComment comment={w.comment} />
      </ItemContent>
      <ItemFooter>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small">
          {w.removable ? (
            <span className="flex items-center gap-1 text-foreground">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
              Safe to delete
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" />
              {w.blocker ?? 'Not safe to delete'}
            </span>
          )}
          {facts.length > 0 && <span className="text-meta text-muted-foreground">{facts.join(' · ')}</span>}
        </div>
        <WorktreeCopyButton w={w} />
      </ItemFooter>
    </Item>
  )
}

/** Something to do about a metric stuck red: what, why, the command to run yourself, and the session it concerns (if any). */
function Suggestion({ s, wt, onClose }: { s: HostSuggestion; wt?: HostWorktree; onClose: () => void }) {
  const set = useApp((st) => st.set)
  const session = useApp((st) => (s.sessionId ? st.sessions[s.sessionId] : undefined))
  // The title or detail may already carry its name (written in by the server): no point saying it twice.
  const note = session?.note
  const noteAlreadyShown = !!note && (s.title.includes(note) || s.detail.includes(note))
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-ui font-medium">{s.title}</h4>
        <p className="text-small text-muted-foreground">{s.detail}</p>
        {note && !noteAlreadyShown && (
          <p className="text-small text-muted-foreground">
            Session: <SessionName note={note} title={session!.title} />
          </p>
        )}
      </div>
      {wt && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WorktreeComment comment={wt.comment} />
          <WorktreeCopyButton w={wt} />
        </div>
      )}
      {s.command && <ShellSnippet title="Run it yourself: Sangha never runs this command" text={s.command} />}
      {s.sessionId && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose()
              openSession(s.sessionId!)
            }}
          >
            Open session
          </Button>
          <Button variant="outline" size="sm" onClick={() => set({ dialog: { kind: 'dismiss', id: s.sessionId! } })}>
            Close session
          </Button>
        </div>
      )}
      <SuggestionChat suggestion={s} />
    </li>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-baseline gap-2 text-meta font-semibold text-muted-foreground">
        {title}
        {aside && <span className="font-normal">{aside}</span>}
      </h3>
      {children}
    </section>
  )
}

const Quiet = ({ children }: { children: React.ReactNode }) => <p className="text-small text-muted-foreground">{children}</p>

/**
 * The machine's full report: suggestions first (what's actionable), then every metric with its history,
 * then what's taking the room: heaviest processes, Docker containers, and worktrees with their session
 * (or none: orphaned).
 */
export function HostDialog({ onClose }: { onClose: () => void }) {
  const host = useApp((s) => s.host)
  const sessions = useApp((s) => s.sessions)
  if (!host) return null // the chip that opens this dialog is itself hidden until a report lands

  // Removable first (stable sort keeps each group in the report's own heaviest-first order), then the rest.
  const worktrees = [...host.worktrees].sort((a, b) => Number(b.removable) - Number(a.removable))
  const removable = worktrees.filter((w) => w.removable)
  const removableBytes = removable.reduce((sum, w) => sum + w.bytes, 0)

  return (
    <Modal
      title={`Machine: ${host.hostname}`}
      description={host.inContainer ? 'Sangha runs in a container: these numbers are its Docker VM, not your machine directly.' : undefined}
      size="lg"
      onClose={onClose}
    >
      <div className="flex flex-col gap-6">
        {host.suggestions.length > 0 && (
          <Section title="To do">
            <ul className="flex flex-col gap-3">
              {host.suggestions.map((s) => (
                <Suggestion key={s.id} s={s} wt={matchSuggestionWorktree(s, host.worktrees)} onClose={onClose} />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Metrics">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {host.metrics.map((m) => (
              <Metric key={m.key} metric={m} history={host.history} />
            ))}
          </div>
        </Section>

        <Section title="Heaviest processes">
          {host.processes.length === 0 ? (
            <Quiet>Nothing to report.</Quiet>
          ) : (
            <div className="rounded-xl border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>Command</TableHead>
                    <TableHead className="w-20 text-right">CPU</TableHead>
                    <TableHead className="w-24 text-right">Memory</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {host.processes.map((p) => (
                    <TableRow key={p.pid}>
                      <TableCell className="truncate font-mono text-meta" title={p.command}>
                        {p.command}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(p.cpu)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(p.rssBytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section title="Docker containers">
          {host.containers === null ? (
            <Quiet>Docker is not available.</Quiet>
          ) : host.containers.length === 0 ? (
            <Quiet>No containers running.</Quiet>
          ) : (
            <div className="rounded-xl border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Name</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead className="w-20 text-right">CPU</TableHead>
                    <TableHead className="w-32 text-right">Memory</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {host.containers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="truncate" title={c.name}>
                        {c.name}
                      </TableCell>
                      <TableCell className="truncate font-mono text-meta" title={c.image}>
                        {c.image}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(c.cpu)}%</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBytes(c.memBytes)} <span className="text-muted-foreground">({Math.round(c.memPct)}%)</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section title="Worktrees" aside={host.worktreesSizedAt != null ? `Sized ${ago(host.worktreesSizedAt) === 'now' ? 'just now' : `${ago(host.worktreesSizedAt)} ago`}` : undefined}>
          {worktrees.length === 0 ? (
            <Quiet>No worktrees.</Quiet>
          ) : (
            <>
              {removable.length > 0 && (
                <p className="text-small text-muted-foreground">
                  {removable.length} safe to delete, {formatBytes(removableBytes)} to reclaim.
                </p>
              )}
              <ItemGroup className="gap-2">
                {worktrees.map((w) => (
                  <WorktreeRow key={w.path} w={w} sessions={sessions} />
                ))}
              </ItemGroup>
            </>
          )}
        </Section>
      </div>
    </Modal>
  )
}
