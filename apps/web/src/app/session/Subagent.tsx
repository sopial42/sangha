import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon, ArrowRight01Icon, Cancel01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { Md } from '@/Md'
import { profileFor, toolIcon } from '@/profiles'
import { useApp, type LogItem, type SubagentRun } from '@/store'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { clock } from '@/lib/time'

const STATUS: Record<string, string> = { working: 'Working', completed: 'Done', failed: 'Failed', stopped: 'Stopped' }

function StatusIcon({ status }: { status: SubagentRun['status'] }) {
  if (status === 'working') return <Spinner className="size-3.5 text-muted-foreground" aria-label={STATUS.working} />
  if (status === 'completed') return <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} className="size-3.5 text-muted-foreground" aria-label={STATUS.completed} />
  if (status === 'failed') return <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.8} className="size-3.5 text-danger" aria-label={STATUS.failed} />
  return <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} className="size-3.5 text-muted-foreground" aria-label={STATUS[status] ?? status} />
}

/** One subagent, folded to a row, unfolded to its whole thread (read-only). */
export function Subagent({ m, sessionId, external, open, onToggle }: { m: SubagentRun; sessionId: string; external: boolean; open: boolean; onToggle: () => void }) {
  const profiles = useApp((s) => s.profiles)
  const p = profileFor(m.agentType, profiles)
  const ref = useRef<HTMLLIElement>(null)
  const [log, setLog] = useState<LogItem[]>(m.log)

  // Sangha's subagents stream with their session; an outside session's are read from their own transcript.
  useEffect(() => {
    if (!external) return setLog(m.log)
    if (!open) return
    let alive = true
    const fetchLog = () =>
      fetch(`/api/sessions/${sessionId}/subagents/${m.subagentId}/log`)
        .then((r) => r.json() as Promise<{ log: LogItem[] }>)
        .then((r) => alive && setLog(r.log))
        .catch(() => undefined)
    void fetchLog()
    const t = m.status === 'working' ? setInterval(fetchLog, 5000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [external, open, m.log, m.status, m.subagentId, sessionId])

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  const lastTool = [...log].reverse().find((l) => l.kind === 'tool')

  return (
    <li ref={ref} className="rounded-lg border">
      <Collapsible open={open} onOpenChange={(next) => next !== open && onToggle()}>
        <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-small font-medium">{p.name === m.agentType ? m.agentType : `${p.name} · ${m.agentType}`}</span>
            {m.description && <span className="truncate text-meta text-muted-foreground">{m.description}</span>}
            {lastTool?.kind === 'tool' && (
              <span className="flex min-w-0 items-center gap-1 font-mono text-meta text-muted-foreground">
                {toolIcon(lastTool.tool)}
                <span className="truncate">
                  {lastTool.tool} {lastTool.summary}
                </span>
              </span>
            )}
          </span>
          <span className="mt-0.5 flex shrink-0 items-center gap-1" title={STATUS[m.status]}>
            <StatusIcon status={m.status} />
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.8} className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-2">
          {m.prompt && (
            <Collapsible>
              <CollapsibleTrigger className="group/task flex items-center gap-1 text-meta font-semibold text-muted-foreground hover:text-foreground">
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.8} className="size-3 transition-transform group-data-panel-open/task:rotate-90" aria-hidden />
                Task
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1 text-small">
                <Md text={m.prompt} />
              </CollapsibleContent>
            </Collapsible>
          )}
          <ol className="flex flex-col gap-1.5">
            {log.length === 0 && <li className="text-meta text-muted-foreground">Nothing yet…</li>}
            {log.map((l, i) =>
              l.kind === 'tool' ? (
                <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-meta text-muted-foreground">
                  {l.at > 0 && <time className="shrink-0 tabular-nums">{clock(l.at)}</time>}
                  <span className="self-center">{toolIcon(l.tool)}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-foreground">{l.tool}</span> {l.summary}
                  </span>
                </li>
              ) : (
                <li key={i} className="flex min-w-0 flex-col gap-0.5 text-small">
                  {l.at > 0 && <time className="font-mono text-meta text-muted-foreground tabular-nums">{clock(l.at)}</time>}
                  <div className="min-w-0 break-words">
                    <Md text={l.text} />
                  </div>
                </li>
              ),
            )}
          </ol>
          {m.summary && (
            <div className="flex flex-col gap-1">
              <h4 className="text-meta font-semibold text-muted-foreground">Report</h4>
              <div className="min-w-0 break-words text-small">
                <Md text={m.summary} />
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
