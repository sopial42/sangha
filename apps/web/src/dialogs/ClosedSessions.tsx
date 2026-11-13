import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, GitBranchIcon, Search01Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { NirvanaEntry, NirvanaSearchResult } from '@sangha/shared'
import { api, openSession } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { PebbleIcon } from '@/components/pebble/Pebble'
import { agentName, formatCost } from '@/lib/sessions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { dateTime } from '@/lib/time'

/**
 * For case/accent-insensitive matching: one normalized character per original character, so a match's
 * position in the normalized string always lines up with the same position in the original text (so
 * highlighting can slice the original, diacritics and casing intact).
 */
function normChar(ch: string): string {
  const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return (stripped || ch).toLowerCase()
}
const normAligned = (s: string): string => Array.from(s).map(normChar).join('')

/** `text` with every stretch matching one of `words` (already normalized) wrapped in a `<mark>`. */
function highlightWords(text: string, words: string[]): ReactNode {
  if (!text || words.length === 0) return text
  const norm = normAligned(text)
  const ranges: [number, number][] = []
  for (const w of words) {
    if (!w) continue
    for (let from = 0; ; ) {
      const idx = norm.indexOf(w, from)
      if (idx < 0) break
      ranges.push([idx, idx + w.length])
      from = idx + 1
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = [ranges[0]!]
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1]!
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push(r)
  }
  const parts: ReactNode[] = []
  let cursor = 0
  merged.forEach(([s, e], i) => {
    if (s > cursor) parts.push(text.slice(cursor, s))
    parts.push(
      <mark key={i} className="rounded-sm bg-amber/25 text-foreground">
        {text.slice(s, e)}
      </mark>,
    )
    cursor = e
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

/**
 * Every closed session, searchable by words (instant, in your own text) or by a question put to a
 * model, and a way to reopen one.
 */
export function ClosedSessions({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const nirvanaTick = useApp((s) => s.nirvanaTick)
  const [entries, setEntries] = useState<NirvanaEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Text (instant, word by word) or AI (a question, sent on demand). An empty field always shows the
  // full list in both modes.
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'text' | 'ai'>('text')
  const [aiResults, setAiResults] = useState<NirvanaSearchResult['results'] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const load = () => api.nirvana().then(setEntries, (err) => setError(message(err)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])
  // The history changed (a session closed, a summary written, one reopened elsewhere): reload it live.
  useEffect(() => {
    if (entries !== null) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nirvanaTick])
  useEffect(() => {
    if (!query.trim()) {
      setMode('text')
      setAiResults(null)
      setAiError(null)
    }
  }, [query])

  const haystack = (e: NirvanaEntry) => normAligned([e.title, e.project, agentName(e, projects), e.branch ?? '', e.summary ?? '', e.note ?? ''].join(' \u0000 '))
  const words = useMemo(() => normAligned(query).trim().split(/\s+/).filter(Boolean), [query])
  const filtered = useMemo(() => {
    if (!entries) return []
    if (words.length === 0) return entries
    return entries.filter((e) => words.every((w) => haystack(e).includes(w)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, words, projects])
  const aiList = useMemo(() => {
    if (!entries || !aiResults) return []
    return aiResults
      .map((r) => ({ r, e: entries.find((x) => x.id === r.id) }))
      .filter((x): x is { r: NirvanaSearchResult['results'][number]; e: NirvanaEntry } => !!x.e)
  }, [entries, aiResults])

  const runAiSearch = async () => {
    const q = query.trim()
    if (!q) return
    setMode('ai')
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await api.nirvanaSearch(q)
      setAiResults(res.results)
    } catch (err) {
      setAiError(message(err))
      setAiResults(null)
    } finally {
      setAiBusy(false)
    }
  }

  const reopen = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await api.reincarnate(id)
      // It comes back on the board through the stream; here, it just leaves the list.
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusyId(null)
    }
  }

  const renderEntry = (e: NirvanaEntry, opts?: { words?: string[]; reason?: string }) => {
    const hl = (s: string) => (opts?.words?.length ? highlightWords(s, opts.words) : s)
    const reopenButton = (
      <Button variant="outline" size="sm" disabled={busyId === e.id} onClick={() => void reopen(e.id)}>
        {busyId === e.id && <Spinner data-icon="inline-start" />}
        Reopen
      </Button>
    )
    return (
      <Item key={e.id} variant="outline" className="items-start">
        <ItemMedia>
          <PebbleIcon sprite="icon-stone-open" size={28} />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          {/* Its name, more prominent than its title: how you tell this one apart at a glance. */}
          <ItemTitle className="text-ui">{hl(e.note || e.title)}</ItemTitle>
          {e.note && <p className="truncate text-small text-muted-foreground">{hl(e.title)}</p>}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
            <span className="text-foreground">{hl(e.project)}</span>
            <span aria-hidden>·</span>
            <span>{hl(agentName(e, projects))}</span>
            {e.branch && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                  <HugeiconsIcon icon={GitBranchIcon} strokeWidth={1.7} className="size-3 shrink-0" />
                  <span className="truncate">{hl(e.branch)}</span>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{dateTime(e.archivedAt)}</span>
            {e.cost != null && e.cost >= 0.01 && (
              <>
                <span aria-hidden>·</span>
                <span>{formatCost(e.cost)}</span>
              </>
            )}
          </p>
          <ItemDescription className="line-clamp-none text-small">
            {e.summary ? hl(e.summary) : <span className="italic">Writing the summary…</span>}
          </ItemDescription>
          {opts?.reason && <p className="text-meta text-muted-foreground italic">{opts.reason}</p>}
          {e.renewed &&
            (e.continuedIn ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto self-start px-0 text-small"
                onClick={() => {
                  onClose()
                  openSession(e.continuedIn!)
                }}
              >
                Continued in a fresh session
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.8} data-icon="inline-end" />
              </Button>
            ) : (
              <Badge variant="secondary" className="self-start">
                Continued in a fresh session, closed too
              </Badge>
            ))}
        </ItemContent>
        <ItemActions>
          {/* Even when renewed, its own conversation can come back (to read it, or to pick up from there). */}
          {e.renewed ? (
            <Tooltip>
              <TooltipTrigger render={reopenButton} />
              <TooltipContent className="max-w-64">
                Brings it back with its old conversation, next to the fresh session. Same folder: do not let both work at once.
              </TooltipContent>
            </Tooltip>
          ) : (
            reopenButton
          )}
        </ItemActions>
      </Item>
    )
  }

  const list = (items: ReactNode[]) => <ItemGroup className="gap-2">{items}</ItemGroup>

  return (
    <Modal size="lg" title="Closed sessions" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
        {entries === null && !error && (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        )}
        {entries?.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <PebbleIcon sprite="icon-stone-open" size={40} />
              </EmptyMedia>
              <EmptyTitle>No closed sessions yet</EmptyTitle>
              <EmptyDescription>Sessions you close show up here with a summary, and you can reopen them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {entries && entries.length > 0 && (
          <>
            <div className="flex flex-col gap-1">
              <InputGroup>
                <InputGroupAddon>
                  <HugeiconsIcon icon={Search01Icon} strokeWidth={1.7} />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label="Search closed sessions"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (mode === 'ai') void runAiSearch()
                    } else if (e.key === 'Escape' && query) {
                      // Clear the field first; a second Escape (field already empty) closes the dialog.
                      e.preventDefault()
                      e.stopPropagation()
                      setQuery('')
                    }
                  }}
                  placeholder="Title, project, branch, name…"
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <InputGroupButton
                          variant={mode === 'ai' ? 'secondary' : 'ghost'}
                          disabled={aiBusy || !query.trim()}
                          onClick={() => void runAiSearch()}
                          aria-pressed={mode === 'ai'}
                        />
                      }
                    >
                      {aiBusy ? <Spinner data-icon="inline-start" /> : <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.7} data-icon="inline-start" />}
                      {aiBusy ? 'Searching…' : 'Ask AI'}
                    </TooltipTrigger>
                    <TooltipContent>Search with AI: ask your question in one sentence</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
              {mode === 'text' && query.trim() && (
                <p className="text-meta text-muted-foreground">
                  {filtered.length} of {entries.length}
                </p>
              )}
            </div>
            {mode === 'ai' && aiError && (
              <p className="text-small text-danger" role="alert">
                {aiError}
              </p>
            )}
            {mode === 'ai' ? (
              !aiBusy &&
              !aiError &&
              aiResults !== null &&
              (aiList.length === 0 ? (
                <p className="text-small text-muted-foreground">Nothing matches this question.</p>
              ) : (
                list(aiList.map(({ e, r }) => renderEntry(e, { reason: r.reason })))
              ))
            ) : filtered.length === 0 ? (
              <p className="text-small text-muted-foreground">Nothing matches these words.</p>
            ) : (
              list(filtered.map((e) => renderEntry(e, { words })))
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
