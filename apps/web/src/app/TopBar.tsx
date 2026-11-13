import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ComputerIcon, SidebarLeftIcon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons'
import { ORCHESTRATOR_SESSION_ID, type CostReport, type QuotaWindow } from '@sangha/shared'
import { api, openSession } from '@/api'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { formatCost } from '@/lib/sessions'
import { PebbleIcon } from '@/components/pebble/Pebble'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  // ⌘K / Ctrl+K: ask the orchestrator, from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        openSession(ORCHESTRATOR_SESSION_ID)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Toggle sessions (⌘B)">
          <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={1.6} />
        </Button>
        <div className="flex items-center gap-2">
          <PebbleIcon sprite="icon-coral-open" size={30} />
          <span className="text-title font-semibold tracking-tight max-sm:hidden">Sangha</span>
        </div>
        <button
          type="button"
          onClick={() => openSession(ORCHESTRATOR_SESSION_ID)}
          aria-label="Ask or start a session"
          className="ml-1 flex h-8 w-80 items-center gap-2 max-md:w-8 max-md:justify-center max-md:p-0 rounded-lg border bg-surface pr-1.5 pl-3 text-left text-ui text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={1.8} className="size-4" />
          <span className="flex-1 max-md:hidden">Ask or start a session…</span>
          <Kbd className="max-md:hidden">⌘K</Kbd>
        </button>
      </div>
      <div className="flex items-center gap-1">
        <MachineChip />
        <UsageButton />
        <SettingsMenu />
      </div>
    </header>
  )
}

/** Only shows up when the machine is under pressure: a light that is always green is noise. */
function MachineChip() {
  const host = useApp((s) => s.host)
  const set = useApp((s) => s.set)
  if (!host || host.level === 'ok') return null
  const worst = [...host.metrics].sort((a, b) => b.value - a.value)[0]
  if (!worst) return null
  return (
    <Button
      variant="ghost"
      onClick={() => set({ dialog: { kind: 'host' } })}
      className={cn('gap-2', host.level === 'red' ? 'text-danger' : 'text-amber')}
    >
      <HugeiconsIcon icon={ComputerIcon} strokeWidth={1.7} data-icon="inline-start" />
      {worst.label} {Math.round(worst.value * 100)}%
    </Button>
  )
}

function UsageButton() {
  const quota = useApp((s) => s.quota)
  const reserve = useApp((s) => s.reserve)
  const windows = [
    { key: 'fiveHour', label: '5-hour window', short: '5h', w: quota?.fiveHour ?? null },
    { key: 'sevenDay', label: 'Weekly', short: 'weekly', w: quota?.sevenDay ?? null },
  ] as const
  // The trigger shows the window closest to its limit.
  const tightest = [...windows].sort((a, b) => (b.w?.utilization ?? 0) - (a.w?.utilization ?? 0))[0]!
  const pct = Math.round((tightest.w?.utilization ?? 0) * 100)
  const high = pct >= 75 || quota?.status === 'rejected'

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="gap-2 pl-2" />}>
        <UsageRing value={tightest.w?.utilization ?? 0} high={high} />
        {quota?.status === 'rejected' ? (
          <span className="font-semibold text-danger">Limit reached</span>
        ) : (
          <>
            {quota ? (
              <>
                <span className="font-semibold">{pct}%</span>
                <span className="font-normal text-muted-foreground max-sm:hidden">{tightest.short}</span>
              </>
            ) : (
              <span className="font-normal text-muted-foreground max-sm:hidden">Usage</span>
            )}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-4 p-4">
        {windows.map(({ key, label, w }) => (
          <QuotaRow key={key} label={label} w={w} reservePct={key === 'sevenDay' && reserve?.enabled ? reserve.pct : null} />
        ))}
        <Separator />
        <ReserveControl />
        <Separator />
        <SpendSummary />
      </PopoverContent>
    </Popover>
  )
}

function UsageRing({ value, high }: { value: number; high: boolean }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <circle cx={9} cy={9} r={r} fill="none" strokeWidth={2.5} className="stroke-border" />
      <circle
        cx={9}
        cy={9}
        r={r}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, value)} ${c}`}
        style={{ transition: 'stroke-dasharray 600ms var(--ease-out-strong), stroke 200ms ease' }}
        transform="rotate(-90 9 9)"
        className={high ? 'stroke-amber' : 'stroke-foreground'}
      />
    </svg>
  )
}

const SEGMENTS = 24

function QuotaRow({ label, w, reservePct }: { label: string; w: QuotaWindow | null; reservePct: number | null }) {
  const pct = Math.round((w?.utilization ?? 0) * 100)
  const on = Math.round(((w?.utilization ?? 0) * SEGMENTS))
  const reserveFrom = reservePct != null ? Math.round(((100 - reservePct) / 100) * SEGMENTS) : SEGMENTS
  const high = pct >= 75
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-small">{label}</span>
        <span className={cn('text-small font-semibold', high && 'text-amber')}>{w ? `${pct}%` : '–'}</span>
      </div>
      <div className="flex gap-[3px]" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div
            key={i}
            className={cn(
              'h-4 flex-1 rounded-[2px]',
              i < on ? (high ? 'bg-amber' : 'bg-foreground') : i >= reserveFrom ? 'bg-amber/15' : 'bg-secondary',
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-meta text-muted-foreground">
        <span>{resetText(w)}</span>
        {reservePct != null && <span>Reserve above {100 - reservePct}%</span>}
      </div>
    </div>
  )
}

function resetText(w: QuotaWindow | null): string {
  if (!w?.resetsAt) return 'No data yet'
  const ms = w.resetsAt * 1000 - Date.now()
  if (ms <= 0) return 'Resets now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `Resets in ${min} min`
  if (min < 12 * 60) return `Resets in ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
  return `Resets ${new Date(w.resetsAt * 1000).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`
}

/** The share of the weekly quota kept untouched: past it, sessions pause until the week starts afresh. */
function ReserveControl() {
  const reserve = useApp((s) => s.reserve)
  const [enabled, setEnabled] = useState(reserve?.enabled ?? true)
  const [pct, setPct] = useState(reserve?.pct ?? 10)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!reserve) return
    setEnabled(reserve.enabled)
    setPct(reserve.pct)
  }, [reserve])

  const save = (patch: { enabled?: boolean; pct?: number }) =>
    api.saveQuotaReserve(patch).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-small">Keep a reserve</span>
          <span className="text-meta text-muted-foreground">
            {enabled ? `Sessions pause past ${100 - pct}% of the week.` : 'Sessions can use the whole quota.'}
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(next) => {
            setEnabled(next)
            void save({ enabled: next })
          }}
        />
      </label>
      {enabled && (
        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={50}
            step={1}
            value={[pct]}
            aria-label="Share of the weekly quota kept in reserve"
            onValueChange={(v) => {
              const next = Array.isArray(v) ? (v[0] ?? pct) : v
              setPct(next)
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => void save({ pct: next }), 300)
            }}
          />
          <span className="w-10 text-right text-small tabular-nums">{pct}%</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** What the sessions would have cost at API prices (they run on the plan), refreshed when the popover opens. */
function SpendSummary() {
  const set = useApp((s) => s.set)
  const [report, setReport] = useState<CostReport | null>(null)
  useEffect(() => {
    api.costs().then(setReport, () => undefined)
  }, [])
  const thisMonth = report?.months[0]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-meta text-muted-foreground">This month</span>
          <span className="text-title font-semibold">{thisMonth ? formatCost(thisMonth.cost) : '–'}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-meta text-muted-foreground">All time</span>
          <span className="text-title font-semibold">{report ? formatCost(report.total) : '–'}</span>
        </div>
      </div>
      <p className="text-meta text-muted-foreground">At API prices. Sessions actually run on your subscription.</p>
      <Button variant="outline" onClick={() => set({ dialog: { kind: 'costs' } })}>
        Cost breakdown
      </Button>
    </div>
  )
}

function SettingsMenu() {
  const set = useApp((s) => s.set)
  const gitIdentity = useApp((s) => s.gitIdentity)
  const models = useApp((s) => s.models)
  const defaultModel = useApp((s) => s.defaultModel)
  const setDefaultModel = useApp((s) => s.setDefaultModel)
  const muted = useApp((s) => s.muted)
  const toggleMuted = useApp((s) => s.toggleMuted)
  const advisorBadge = useApp((s) => s.advisorBadge)
  const gitMissing = gitIdentity === null
  const open = (dialog: Parameters<typeof set>[0]['dialog']) => set({ dialog })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label="Settings" />}>
        <HugeiconsIcon icon={SlidersHorizontalIcon} strokeWidth={1.6} />
        {gitMissing ? (
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background bg-amber" />
        ) : (
          advisorBadge &&
          advisorBadge.proposed > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full border-2 border-background bg-foreground" aria-label="New Advisor topics" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {gitMissing && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => open({ kind: 'git' })} className="text-amber">
                Set your git identity
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          {models.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Default model</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={models.some((m) => m.id === defaultModel) ? defaultModel : ''} onValueChange={(v) => setDefaultModel(String(v))}>
                  {models.map((m) => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>
                      {m.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={() => open({ kind: 'providers' })}>Model providers</DropdownMenuItem>
          <DropdownMenuItem onClick={() => open({ kind: 'mcp' })}>MCP servers</DropdownMenuItem>
          {!gitMissing && <DropdownMenuItem onClick={() => open({ kind: 'git' })}>Git identity</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => open({ kind: 'add-project' })}>Add a project</DropdownMenuItem>
          <DropdownMenuItem onClick={() => open({ kind: 'closed-sessions' })}>Closed sessions</DropdownMenuItem>
          <DropdownMenuItem onClick={() => open({ kind: 'advisor' })}>
            Advisor
            {advisorBadge && advisorBadge.proposed > 0 && <span className="ml-auto text-meta text-coral">{advisorBadge.proposed} new</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => open({ kind: 'host' })}>Machine</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem checked={!muted} onCheckedChange={() => toggleMuted()}>
            Sound when a session finishes
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
