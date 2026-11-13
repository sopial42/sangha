import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ArrowDown01Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import type { SessionSummary } from '@sangha/shared'
import { api, lotusFailure, openSession } from '@/api'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { groupOf, nameOf, pebbleOf, sessionsOf, statusLine, needsYou, type Group } from '@/lib/sessions'
import { PebbleIcon } from '@/components/pebble/Pebble'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const GROUPS: { key: Group; label: string }[] = [
  { key: 'needs', label: 'Needs you' },
  { key: 'working', label: 'Working' },
  { key: 'idle', label: 'Idle' },
]

const GROUP_BY_KEY = 'sangha.groupBy'

/** Needs you first, then the most recent: what you should look at is always at the top. */
const byUrgency = (a: SessionSummary, b: SessionSummary) => Number(needsYou(b)) - Number(needsYou(a)) || b.createdAt - a.createdAt

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const all = useApp((s) => s.sessions)
  const projects = useApp((s) => s.projects)
  const selectedId = useApp((s) => s.selectedId)
  const set = useApp((s) => s.set)
  const [groupBy, setGroupBy] = useState<'status' | 'project'>(() => (localStorage.getItem(GROUP_BY_KEY) === 'project' ? 'project' : 'status'))
  const sessions = sessionsOf(all).filter((s) => !s.lotus)
  const setAside = sessionsOf(all).filter((s) => s.lotus)

  const sections =
    groupBy === 'status'
      ? GROUPS.map((g) => ({ key: g.key, label: g.label, project: null as string | null, items: sessions.filter((s) => groupOf(s) === g.key).sort(byUrgency) }))
      : [...new Set([...projects.map((p) => p.name), ...sessions.map((s) => s.project)])].map((name) => ({
          key: name,
          label: name,
          project: name,
          items: sessions.filter((s) => s.project === name).sort(byUrgency),
        }))

  if (collapsed) {
    return (
      <nav aria-label="Sessions" className="flex w-16 shrink-0 flex-col items-center border-r bg-sidebar">
        <ScrollArea className="min-h-0 w-full flex-1">
          <div className="flex flex-col items-center gap-1 py-3">
            {GROUPS.map((g, i) => {
              const items = sessions.filter((s) => groupOf(s) === g.key).sort(byUrgency)
              if (!items.length) return null
              return (
                <div key={g.key} className="flex flex-col items-center gap-1">
                  {i > 0 && <div className="my-1.5 h-px w-6 bg-border" />}
                  {items.map((s) => (
                    <Tooltip key={s.id}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => openSession(s.id)}
                            aria-label={nameOf(s)}
                            className={cn('relative flex h-10 w-11 items-center justify-center rounded-xl hover:bg-sidebar-accent', s.id === selectedId && 'bg-sidebar-accent')}
                          />
                        }
                      >
                        <PebbleIcon sprite={pebbleOf(s, true).sprite} size={30} />
                        {needsYou(s) && <span className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-sidebar bg-coral transition-[opacity,scale] duration-200 ease-out-strong starting:scale-50 starting:opacity-0" />}
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {nameOf(s)} · {s.project}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </nav>
    )
  }

  return (
    <nav aria-label="Sessions" className="flex w-66 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex flex-col gap-2 px-3 pt-4 pb-2">
        <Button variant="outline" className="w-full justify-start" onClick={() => set({ dialog: { kind: 'new-session' } })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={1.8} data-icon="inline-start" />
          New session
        </Button>
        <ToggleGroup
          value={[groupBy]}
          onValueChange={(v) => {
            // Clicking the pressed item sends [] in Base UI: keep the current grouping.
            if (!v.length) return
            const next = v[0] === 'project' ? 'project' : 'status'
            localStorage.setItem(GROUP_BY_KEY, next)
            setGroupBy(next)
          }}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <ToggleGroupItem value="status" className="flex-1">
            Status
          </ToggleGroupItem>
          <ToggleGroupItem value="project" className="flex-1">
            Project
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 px-3 pt-2 pb-4">
          {sections.map((sec) =>
            sec.items.length === 0 && !sec.project ? null : (
              <section key={sec.key} aria-label={sec.label} className="flex flex-col gap-1">
                <div className="flex h-6 items-center justify-between px-3">
                  <h3 className="text-meta font-semibold text-muted-foreground">{sec.label}</h3>
                  {sec.project ? (
                    <ProjectMenu name={sec.project} />
                  ) : (
                    <span className="text-meta text-muted-foreground tabular-nums">{sec.items.length}</span>
                  )}
                </div>
                {sec.items.map((s) => (
                  <SessionRow key={s.id} s={s} selected={s.id === selectedId} showProject={groupBy === 'status'} />
                ))}
              </section>
            ),
          )}
          {sessions.length === 0 && <p className="px-3 text-small text-muted-foreground">No sessions yet. Start one, or ask the orchestrator.</p>}
          {setAside.length > 0 && <SetAside sessions={setAside} selectedId={selectedId} />}
        </div>
      </ScrollArea>
    </nav>
  )
}

/** A project's own actions: start a session in it, or remove it from Sangha. */
export function ProjectMenu({ name, className }: { name: string; className?: string }) {
  const set = useApp((s) => s.set)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className={className} aria-label={`${name} actions`} />}>
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => set({ dialog: { kind: 'new-session', project: name } })}>New session</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={() => set({ dialog: { kind: 'remove-project', name } })}>
            Remove project…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Sessions you set aside: off the board, one click from coming back. */
function SetAside({ sessions, selectedId }: { sessions: SessionSummary[]; selectedId: string | null }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <Collapsible className="flex flex-col gap-1">
      <CollapsibleTrigger className="group flex h-6 items-center justify-between rounded-lg px-3 text-meta font-semibold text-muted-foreground hover:text-foreground">
        <span>Set aside</span>
        <span className="flex items-center gap-1 tabular-nums">
          {sessions.length}
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.8} className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1">
        {sessions.map((s) => (
          <div key={s.id} className="group/row flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SessionRow s={s} selected={s.id === selectedId} showProject />
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
              onClick={() => api.lotus(s.id, false).then(() => setError(null), (e: unknown) => setError(lotusFailure(e)))}
            >
              Put back
            </Button>
          </div>
        ))}
        {error && (
          <p role="alert" className="px-3 text-meta text-danger">
            {error}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function SessionRow({ s, selected, showProject }: { s: SessionSummary; selected: boolean; showProject: boolean }) {
  const needs = needsYou(s)
  const tone = s.status === 'error' ? 'text-danger' : needs ? 'text-coral' : s.status === 'interrupted' ? 'text-amber' : 'text-muted-foreground'
  return (
    <button
      type="button"
      data-session-id={s.id}
      onClick={() => openSession(s.id)}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        selected && 'bg-sidebar-accent',
      )}
    >
      <span className="flex w-7.5 shrink-0 justify-center">
        <PebbleIcon sprite={pebbleOf(s, true).sprite} size={30} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-ui font-medium">{nameOf(s)}</span>
        <span className="truncate text-meta">
          <span className={tone}>{statusLine(s)}</span>
          {showProject && <span className="text-muted-foreground"> · {s.project}</span>}
          {s.external && <span className="text-muted-foreground"> · terminal</span>}
        </span>
      </span>
      <span className="flex size-2 shrink-0">
        {needs && <span className="size-2 rounded-full bg-coral transition-[opacity,scale] duration-200 ease-out-strong starting:scale-50 starting:opacity-0" />}
      </span>
    </button>
  )
}
