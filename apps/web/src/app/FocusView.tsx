import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, MoreHorizontalIcon, SidebarRightIcon } from '@hugeicons/core-free-icons'
import { BUDDHA_SESSION_ID, type SessionSummary } from '@sangha/shared'
import { api, ApiError, closeSession, lotusFailure, openSession } from '@/api'
import { Chat } from '@/chat/Chat'
import { goToNeighbour, popupOpen } from '@/nav'
import { ConversationFeedback, McpPanel, ModelPick, Novice, ProgressCard, ReminderBox, RemoteBanner, ScriptItem } from '@/app/session'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { clock } from '@/lib/time'
import { agentName, duration, formatCost, formatTokens, FRESH_START_AT, nameOf, needsYou, pebbleOf, shortenPath, statusLine } from '@/lib/sessions'
import { PebbleIcon } from '@/components/pebble/Pebble'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const DETAILS_KEY = 'sangha.details'

/** A session in focus: a wide conversation, its details on the right. Esc goes back to the board. */
export function FocusView({ s }: { s: SessionSummary }) {
  const projects = useApp((st) => st.projects)
  const dialog = useApp((st) => st.dialog)
  const [details, setDetails] = useState(() => localStorage.getItem(DETAILS_KEY) !== '0')
  const [mcpOpen, setMcpOpen] = useState(false)
  const isOrchestrator = s.id === BUDDHA_SESSION_ID
  const agent = isOrchestrator ? 'Orchestrator' : agentName(s, projects)

  const toggleDetails = () => {
    localStorage.setItem(DETAILS_KEY, details ? '0' : '1')
    setDetails(!details)
  }

  // Looking at a finished session counts as having read it.
  useEffect(() => {
    if (s.status !== 'waiting') return
    const markSeen = () => document.visibilityState === 'visible' && void api.seen(s.id)
    markSeen()
    document.addEventListener('visibilitychange', markSeen)
    return () => document.removeEventListener('visibilitychange', markSeen)
  }, [s.id, s.status])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (mcpOpen) return setMcpOpen(false)
      if (!dialog && !popupOpen()) closeSession()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, mcpOpen])

  const remote = useRemoteControl(s)
  const selectedMonk = useApp((st) => st.selectedMonk)

  // A switch of session closes the MCP popover (it would show the previous session's servers).
  useEffect(() => setMcpOpen(false), [s.id])

  // Picking a subagent from the conversation shows it in the details panel, opened if needed.
  useEffect(() => {
    if (selectedMonk && !details) setDetails(true)
  }, [selectedMonk])

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-labelledby="focus-title" className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          <Button variant="outline" onClick={closeSession} className="pl-2">
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.8} data-icon="inline-start" />
            Board
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <PebbleIcon sprite={isOrchestrator ? 'icon-stone-open' : pebbleOf(s, true).sprite} size={34} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 id="focus-title" className="truncate text-title font-semibold">
              {isOrchestrator ? 'Orchestrator' : nameOf(s)}
            </h1>
            <p className="truncate text-small text-muted-foreground">
              {isOrchestrator ? (
                'Ask anything: it starts and follows sessions for you'
              ) : (
                <>
                  <span className={cn(needsYou(s) && 'text-coral', s.status === 'error' && 'text-danger')}>{statusLine(s)}</span> · {s.project} · {agent}
                  {s.external && ' · started in a terminal'}
                </>
              )}
            </p>
          </div>
          {!isOrchestrator && <SessionMenu s={s} remote={remote} />}
          <Button variant={details ? 'secondary' : 'ghost'} size="icon" onClick={toggleDetails} aria-label={details ? 'Hide details' : 'Show details'} aria-pressed={details}>
            <HugeiconsIcon icon={SidebarRightIcon} strokeWidth={1.6} />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {!isOrchestrator && remote.url && <RemoteBanner url={remote.url} busy={remote.busy} onStop={remote.stop} />}
          {!isOrchestrator && !remote.url && remote.pending && (
            <p className="mx-auto w-full max-w-3xl px-8 pt-3 text-small text-muted-foreground">Remote Control starts when this turn ends: nothing is cut.</p>
          )}
          {remote.error && (
            <p role="alert" className="mx-auto w-full max-w-3xl px-8 pt-3 text-small text-danger">
              {remote.error}
            </p>
          )}
          {!isOrchestrator && (
            <div className="mx-auto w-full max-w-3xl px-8 pt-4">
              <ProgressCard session={s} />
            </div>
          )}
          <Chat author={isOrchestrator ? 'Orchestrator' : agent} external={s.external ? { alive: s.alive } : null} />
        </div>
      </section>

      {details && !isOrchestrator && <Details s={s} agent={agent} mcpOpen={mcpOpen} setMcpOpen={setMcpOpen} />}
    </div>
  )
}

type Remote = ReturnType<typeof useRemoteControl>

/** Hands the conversation to claude.ai (Remote Control), or takes it back. */
function useRemoteControl(s: SessionSummary) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startedUrl, setStartedUrl] = useState<string | null>(null)
  const [pendingLocal, setPendingLocal] = useState(false)
  useEffect(() => {
    setError(null)
    setStartedUrl(null)
    setPendingLocal(false)
  }, [s.id])
  const url = s.remote ?? startedUrl
  const pending = !url && (s.remotePending || pendingLocal)
  const start = () => {
    setBusy(true)
    setError(null)
    api
      .remoteControl(s.id)
      .then((res) => {
        if ('pending' in res) return setPendingLocal(true)
        setStartedUrl(res.url)
        void navigator.clipboard?.writeText(res.url).catch(() => {})
        window.open(res.url, '_blank', 'noopener')
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Your Sangha server does not know Remote Control yet: restart it (make dev).' : e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false))
  }
  const stop = () => {
    setBusy(true)
    setError(null)
    api
      .stopRemote(s.id)
      .then(() => {
        setStartedUrl(null)
        setPendingLocal(false)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return { url, pending, busy, error, start, stop, setError }
}

/** Every session action, in plain words, in one menu. */
function SessionMenu({ s, remote }: { s: SessionSummary; remote: Remote }) {
  const set = useApp((st) => st.set)
  const open = (dialog: Parameters<typeof set>[0]['dialog']) => set({ dialog })
  const handedOff = s.shepherd && s.shepherd.state !== 'refused'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Session actions" />}>
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          {s.status === 'interrupted' && <DropdownMenuItem onClick={() => void api.resume(s.id)}>Resume</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => open({ kind: 'note', id: s.id })}>{s.note ? 'Rename' : 'Add a name'}</DropdownMenuItem>
          {!s.external && <DropdownMenuItem onClick={() => open({ kind: 'autonomy', id: s.id })}>{s.autonomy?.active ? 'Autonomy (running)' : 'Autonomy…'}</DropdownMenuItem>}
          {!s.external && <DropdownMenuItem onClick={() => open({ kind: 'env', id: s.id })}>Environment variables{Object.keys(s.env ?? {}).length ? ` (${Object.keys(s.env).length})` : ''}</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {(!s.external || s.alive) && (
            <DropdownMenuItem onClick={() => (handedOff ? void api.shepherd(s.id, false) : open({ kind: 'shepherd', id: s.id }))}>
              {handedOff ? 'Stop the hand-off to a fresh session' : 'Hand off to a fresh session…'}
            </DropdownMenuItem>
          )}
          {!s.external && (
            <DropdownMenuItem
              onClick={() => {
                if (s.status === 'working' && !confirm(`${nameOf(s)} is working: restarting interrupts its turn. Restart anyway?`)) return
                void api.restart(s.id)
              }}
            >
              Restart (reload agent, tools and MCP)
            </DropdownMenuItem>
          )}
          {!s.external &&
            (remote.url || remote.pending ? (
              <DropdownMenuItem onClick={remote.stop} disabled={remote.busy}>
                {remote.url ? 'Stop Remote Control' : 'Cancel Remote Control'}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={remote.start} disabled={remote.busy}>
                Continue on claude.ai (Remote Control)
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem onClick={() => window.open(`/?session=${encodeURIComponent(s.id)}`, '_blank', 'noopener')}>Open in a new tab</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => goToNeighbour(-1)}>
            Previous session
            <DropdownMenuShortcut>←</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => goToNeighbour(1)}>
            Next session
            <DropdownMenuShortcut>→</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void api.silence(s.id, !s.silenced)}>{s.silenced ? 'Unmute' : 'Mute (never asks for attention)'}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              s.lotus || s.note
                ? api.lotus(s.id, !s.lotus).then(() => remote.setError(null), (e: unknown) => remote.setError(lotusFailure(e)))
                : open({ kind: 'note', id: s.id, lotus: true })
            }
          >
            {s.lotus ? 'Put back on the board' : 'Set aside'}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => open({ kind: 'dismiss', id: s.id })}>
            {s.external ? 'Remove from board (the terminal keeps running)' : 'Close session'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const SEGMENTS = 24
const CONTEXT_MAX = 1_000_000

function Details({ s, agent, mcpOpen, setMcpOpen }: { s: SessionSummary; agent: string; mcpOpen: boolean; setMcpOpen: (open: boolean) => void }) {
  const view = useApp((st) => st.view)
  const selectedMonk = useApp((st) => st.selectedMonk)
  const set = useApp((st) => st.set)
  const novices = view.monkOrder.map((id) => view.monks[id]!).filter(Boolean)
  const scripts = s.scripts ?? []
  const ctx = s.context ?? 0
  const heavy = ctx >= FRESH_START_AT
  const on = Math.round(Math.min(1, ctx / CONTEXT_MAX) * SEGMENTS)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!scripts.length) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [scripts.length])

  return (
    <aside aria-label="Session details" className="flex w-75 shrink-0 flex-col border-l bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-6">
          {s.context != null && (
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-meta font-semibold text-muted-foreground">Context</h2>
                <span className="text-small">
                  <span className="font-semibold">{formatTokens(ctx)}</span>
                  <span className="text-muted-foreground"> of 1M</span>
                </span>
              </div>
              <div className="flex gap-[3px]" role="meter" aria-label="Context size" aria-valuenow={ctx} aria-valuemin={0} aria-valuemax={CONTEXT_MAX}>
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <div key={i} className={cn('h-3.5 flex-1 rounded-[2px]', i < on ? (heavy ? 'bg-amber' : 'bg-stone') : 'bg-secondary')} />
                ))}
              </div>
              {heavy && <p className="text-meta text-muted-foreground">Past 400K, answers get worse. A fresh session keeps the branch, worktree and agent.</p>}
              {!s.external && (
                <Button variant="outline" onClick={() => void api.renew(s.id)} disabled={s.status === 'working'}>
                  {s.renewal === 'asked' ? 'Fresh start proposed…' : s.renewal === 'postponed' ? 'Start fresh (postponed)' : 'Start fresh'}
                </Button>
              )}
            </section>
          )}

          <Separator />
          <section className="flex flex-col gap-2.5">
            <h2 className="text-meta font-semibold text-muted-foreground">Session</h2>
            {(s.pr?.branch ?? s.branch) && <Row k="Branch" v={s.pr?.branch ?? s.branch!} mono />}
            {s.pr && (
              <Row
                k="Pull request"
                v={
                  <a href={s.pr.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                    #{s.pr.number} · {s.pr.state}
                  </a>
                }
              />
            )}
            {s.cwd && <Row k="Folder" v={shortenPath(s.cwd)} mono />}
            <Row k="Agent" v={agent} />
            {!s.external && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-small text-muted-foreground">Model</span>
                <ModelPick session={s} />
              </div>
            )}
            <Row k="Started" v={`${duration(s.createdAt)} ago`} />
            {s.cost != null && s.cost >= 0.01 && <Row k="Cost (API prices)" v={formatCost(s.cost)} />}
            {s.parent && <ParentRow id={s.parent} />}
            {s.autonomy && <Row k={s.autonomy.mode === 'goal' ? 'Goal' : 'Loop'} v={`${s.autonomy.text}${s.autonomy.active ? '' : ' (stopped)'}`} />}
            {s.autonomy?.mode === 'loop' && s.autonomy.active && s.autonomy.nextAt && <Row k="Next wake-up" v={clock(s.autonomy.nextAt)} />}
            {s.shepherd && <Row k="Hand-off" v={handOffText(s.shepherd)} title={s.shepherd.note ?? undefined} />}
            {!s.external && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-small text-muted-foreground">MCP servers</span>
                <McpPanel sessionId={s.id} open={mcpOpen} onToggleOpen={() => setMcpOpen(!mcpOpen)} onClose={() => setMcpOpen(false)} />
              </div>
            )}
          </section>

          <Separator />
          <section className="flex flex-col gap-2">
            <h2 className="text-meta font-semibold text-muted-foreground">Standing instruction</h2>
            <ReminderBox key={s.id} id={s.id} saved={s.reminder} />
          </section>

          {scripts.length > 0 && (
            <>
              <Separator />
              <section className="flex flex-col gap-2">
                <h2 className="text-meta font-semibold text-muted-foreground">Running scripts ({scripts.length})</h2>
                <ul className="flex flex-col gap-2">
                  {scripts.map((script) => (
                    <ScriptItem key={script.id} script={script} now={now} />
                  ))}
                </ul>
              </section>
            </>
          )}

          {novices.length > 0 && (
            <>
              <Separator />
              <section className="flex flex-col gap-2">
                <h2 className="text-meta font-semibold text-muted-foreground">Subagents ({novices.length})</h2>
                <ul className="flex flex-col gap-2">
                  {[...novices].reverse().map((m) => (
                    <Novice
                      key={m.monkId}
                      m={m}
                      sessionId={s.id}
                      external={s.external}
                      open={selectedMonk === m.monkId}
                      onToggle={() => set({ selectedMonk: selectedMonk === m.monkId ? null : m.monkId })}
                    />
                  ))}
                </ul>
              </section>
            </>
          )}

          <Separator />
          <ConversationFeedback key={s.id} sessionId={s.id} />
        </div>
      </ScrollArea>
    </aside>
  )
}

function handOffText(h: NonNullable<SessionSummary['shepherd']>) {
  if (h.state === 'asked') return 'Waiting for its answer'
  if (h.state === 'refused') return 'Declined a fresh start'
  return h.nextAt > Date.now() ? `Asks again at ${clock(h.nextAt)}` : 'Asks when the turn ends'
}

/** "Started by" another session (a headless `claude -p` launched from its shell): a link back to it. */
function ParentRow({ id }: { id: string }) {
  const parent = useApp((st) => st.sessions[id])
  if (!parent) return null
  return (
    <Row
      k="Started by"
      v={
        <button type="button" onClick={() => openSession(id)} className="underline-offset-4 hover:underline">
          {nameOf(parent)}
        </button>
      }
    />
  )
}

function Row({ k, v, mono, title }: { k: string; v: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <span className="shrink-0 text-small text-muted-foreground">{k}</span>
      <span className={cn('min-w-0 truncate text-right text-small', mono && 'font-mono text-meta')}>{v}</span>
    </div>
  )
}
