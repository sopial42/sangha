import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { BUDDHA_SESSION_ID, type SessionSummary } from '@sangha/shared'
import { openSession } from '@/api'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { agentName, cairnOf, duration, formatTokens, nameOf, needsYou, pebbleOf, sessionsOf, statusLine } from '@/lib/sessions'
import { BoardPebble } from '@/components/pebble/Pebble'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Kbd } from '@/components/ui/kbd'
import { ProjectMenu } from './Sidebar'
import { changeOf, isPrimed, primeSeen } from '@/lib/seen'

/** Zones and pebbles sit on an isometric (2:1) floor. */
const GAP = 1.12 // centre-to-centre distance between zones, in half-widths
const MAX_HW = 170
const TOP = 210 // room for the orchestrator above the first row
/** The isometric floor grid, drawn once as a repeating background. */
const GRID = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><path d="M0 15 L30 0 L60 15 L30 30 Z" fill="none" stroke="#19191b" stroke-width="1"/></svg>')}")`
const SLOTS: [number, number][] = [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]

type Zone = { name: string; cx: number; cy: number; hw: number; hh: number; add?: boolean }
type Placed = { s: SessionSummary; x: number; y: number; scale: number; child: boolean }

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e!.contentRect.width, height: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, ...size }
}

export function Board() {
  const all = useApp((s) => s.sessions)
  const projects = useApp((s) => s.projects)
  const set = useApp((s) => s.set)
  const { ref, width, height: viewHeight } = useSize<HTMLDivElement>()
  const [hovered, setHovered] = useState<string | null>(null)

  const sessions = sessionsOf(all).filter((s) => !s.lotus)
  const orchestrator = all[BUDDHA_SESSION_ID]
  const names = [...new Set([...projects.map((p) => p.name), ...sessions.map((s) => s.project)])]

  const layout = useMemo(() => {
    const n = names.length + 1 // + the "add a project" zone
    const cols = n <= 2 ? 2 : width > 1000 ? 3 : 2
    const hw = Math.max(110, Math.min(MAX_HW, (width - 64) / (2 * GAP * (cols - 1) + 2)))
    const hh = hw / 2
    const ox = GAP * hw
    const oy = GAP * hh
    const rows = Math.ceil(n / cols)
    const zones: Zone[] = [...names, '+'].map((name, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      return { name, cx: width / 2 + (c - (cols - 1) / 2) * 2 * ox, cy: TOP + hh + r * 2 * oy, hw, hh, add: name === '+' }
    })
    const height = TOP + hh * 2 + (rows - 1) * 2 * oy + 80
    const scale = Math.max(0.5, Math.min(0.75, (hw / 158) * 0.68))
    return { zones, height, scale, links: names.length <= 4 }
  }, [width, names.join('|')])

  // Each project's sessions on a small isometric lattice inside its zone; children beside their parent.
  const placed: Placed[] = []
  const overflow: { z: Zone; n: number }[] = []
  // One floating label per zone, above it: the most urgent session (errors first), then how many more need you.
  const labels: { z: Zone; s: SessionSummary; more: number }[] = []
  for (const z of layout.zones) {
    if (z.add) continue
    const here = sessions.filter((s) => s.project === z.name)
    const tops = here.filter((s) => !s.parent || !here.some((p) => p.id === s.parent))
    // Past the lattice, the rest are counted (they are all in the sidebar); needs-you ones get the seats first.
    tops.sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)))
    if (tops.length > SLOTS.length) overflow.push({ z, n: tops.length - SLOTS.length })
    const calling = here.filter((s) => !s.parent && needsYou(s)).sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error') || b.createdAt - a.createdAt)
    if (calling.length) labels.push({ z, s: calling[0]!, more: calling.length - 1 })
    // A busy zone: smaller pebbles, spread wider, so none hides another or the project's name.
    const busy = Math.min(tops.length, SLOTS.length) > 4
    const scale = busy ? layout.scale * 0.78 : layout.scale
    const spread = busy ? 0.4 : 0.34
    tops.slice(0, SLOTS.length).forEach((s, i) => {
      const [u, v] = SLOTS[i]!
      const x = z.cx + (u - v) * z.hw * spread
      const y = z.cy + (u + v) * z.hh * spread - z.hh * 0.12
      placed.push({ s, x, y, scale, child: false })
      here
        .filter((c) => c.parent === s.id)
        .forEach((c, k) => placed.push({ s: c, x: x + 52 * scale + k * 26 * scale, y: y + 22 * scale + k * 12 * scale, scale: scale * 0.55, child: true }))
    })
  }
  placed.sort((a, b) => a.y - b.y)
  const byId = new Map(placed.map((p) => [p.s.id, p]))

  const orch = { x: width / 2, y: 128 }
  const orchSprite = !orchestrator ? null : needsYou(orchestrator) ? 'coral-up' : orchestrator.status === 'working' ? 'stone-closed' : 'stone-open-cairn1'

  // The first real data is the baseline: nothing animates on first paint, only what changes after it.
  if (!isPrimed() && Object.keys(all).length > 0)
    primeSeen([
      ...placed.map((p): [string, string] => [`p:${p.s.id}`, pebbleOf(p.s).sprite]),
      ...labels.map((l): [string, string] => [`l:${l.z.name}`, l.s.id]),
      ['orch', orchSprite ?? ''],
    ])
  const orchChange = orchSprite ? changeOf('orch', orchSprite) : null
  return (
    <div ref={ref} className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" style={{ backgroundImage: GRID, backgroundSize: '60px 30px' }}>
      {!names.length ? (
        <EmptyBoard onAdd={() => set({ dialog: { kind: 'add-project' } })} />
      ) : (
      <div className="relative shrink-0" style={{ height: layout.height, marginTop: Math.max(0, (viewHeight - layout.height) / 2) }}>
        <svg aria-hidden className="absolute inset-0 size-full">
          {layout.links &&
            layout.zones
              .filter((z) => !z.add)
              .map((z) => <path key={z.name} d={`M${orch.x} ${orch.y + 18} L${z.cx} ${z.cy - z.hh + 8}`} className="stroke-[#2f2f33]" strokeWidth={1.1} fill="none" />)}
          {layout.zones.map((z) => (
            <ZoneTile key={z.name} z={z} hovered={hovered === z.name} onHover={setHovered} onAdd={() => set({ dialog: { kind: 'add-project' } })} />
          ))}
          {placed
            .filter((p) => p.child && p.s.parent && byId.has(p.s.parent))
            .map((p) => {
              const parent = byId.get(p.s.parent!)!
              return <path key={p.s.id} d={`M${parent.x + 10} ${parent.y} L${p.x} ${p.y}`} className="stroke-[#5a5a5e]" strokeWidth={1.2} />
            })}
        </svg>

        {orchSprite && (
          <BoardPebble
            sprite={orchSprite}
            ring={orchSprite === 'coral-up' ? 'needs' : null}
            motion={orchChange === 'changed' ? 'swap' : null}
            ping={orchChange === 'changed' && orchSprite === 'coral-up'}
            x={orch.x}
            y={orch.y}
            scale={0.95}
          >
            <button
              type="button"
              aria-label="Open the orchestrator"
              onClick={() => openSession(BUDDHA_SESSION_ID)}
              className="absolute inset-0 rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </BoardPebble>
        )}

        {placed.map((p) => (
          <SessionPebble key={p.s.id} p={p} change={changeOf(`p:${p.s.id}`, pebbleOf(p.s).sprite)} />
        ))}

        {labels.map(({ z, s, more }) => (
          <button
            key={z.name}
            type="button"
            onClick={() => openSession(s.id)}
            className={cn(
              'absolute flex max-w-72 -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border bg-card py-1 pr-2.5 pl-2 whitespace-nowrap shadow-lg transition-colors hover:border-ring/60',
              changeOf(`l:${z.name}`, s.id) && 'motion-enter',
            )}
            style={{ left: z.cx, top: z.cy - z.hh - 44 }}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', s.status === 'error' ? 'bg-danger' : 'bg-coral')} />
            <span className="min-w-0 truncate text-meta font-semibold">{nameOf(s)}</span>
            <span className="shrink-0 text-meta text-muted-foreground">{s.status === 'error' ? 'Error' : statusLine(s)}</span>
            {more > 0 && <span className="shrink-0 text-meta text-coral">+{more}</span>}
          </button>
        ))}

        {overflow.map(({ z, n }) => (
          <span
            key={z.name}
            className="pointer-events-none absolute -translate-x-1/2 rounded-full border bg-card px-2 py-0.5 text-meta text-muted-foreground"
            style={{ left: z.cx, top: z.cy + z.hh * 0.62 }}
          >
            +{n} more in the sidebar
          </span>
        ))}

        {layout.zones
          .filter((z) => !z.add && hovered === z.name)
          .map((z) => (
            <div
              key={z.name}
              className="absolute flex items-center gap-1 rounded-full border bg-card p-0.5 shadow-lg transition-opacity duration-150 starting:opacity-0"
              style={{ left: z.cx + z.hw * 0.12, top: z.cy + z.hh * 0.4 }}
              onMouseEnter={() => setHovered(z.name)}
            >
              <Button size="sm" className="rounded-full" onClick={() => set({ dialog: { kind: 'new-session', project: z.name } })}>
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
                New session
              </Button>
              <ProjectMenu name={z.name} className="rounded-full" />
            </div>
          ))}
      </div>
      )}
    </div>
  )
}

function ZoneTile({ z, hovered, onHover, onAdd }: { z: Zone; hovered: boolean; onHover: (name: string | null) => void; onAdd: () => void }) {
  const { cx, cy, hw, hh } = z
  const t = 10
  const top = `${cx - hw},${cy} ${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh}`
  const side = `${cx - hw},${cy} ${cx},${cy + hh} ${cx + hw},${cy} ${cx + hw},${cy + t} ${cx},${cy + hh + t} ${cx - hw},${cy + t}`
  // The project's name, written flat on the floor along the front-left edge.
  const lx = cx - hw + 0.14 * hw + 18
  const ly = cy + 0.14 * hh + 1
  const fs = Math.max(16, Math.min(26, (hw / 158) * (z.name.length < 10 ? 24 : 19)))
  // Along the front-left edge there is room for about this many characters.
  const room = Math.floor((Math.hypot(hw, hh) * 0.78) / (fs * 0.62))
  const label = z.name.length > room ? `${z.name.slice(0, room - 1)}…` : z.name

  if (z.add) {
    return (
      <g className="pointer-events-auto cursor-pointer" onClick={onAdd} role="button" aria-label="Add a project">
        <polygon points={top} fill="transparent" stroke="#2e2e31" strokeDasharray="6 6" strokeWidth={1.2} strokeLinejoin="round" className="hover:stroke-[#4a4a4e]" />
        <text x={cx} y={cy + 5} textAnchor="middle" className="fill-muted-foreground text-small font-medium">
          + Add a project
        </text>
      </g>
    )
  }
  return (
    <g className="pointer-events-auto" onMouseEnter={() => onHover(z.name)} onMouseLeave={() => onHover(null)}>
      <g strokeLinejoin="round" strokeWidth={14}>
        <polygon points={side} fill="#141415" stroke="#141415" />
        <polygon points={top} fill={hovered ? '#222225' : '#1e1e20'} stroke={hovered ? '#222225' : '#1e1e20'} />
      </g>
      <polygon points={top} fill="none" stroke={hovered ? '#3a3a3e' : '#2a2a2d'} strokeWidth={1} strokeLinejoin="round" />
      <text transform={`matrix(0.894,0.447,-0.894,0.447,${lx},${ly})`} fontSize={fs} fontWeight={600} className="fill-[#7a7a80] select-none">
        {label}
      </text>
    </g>
  )
}

function SessionPebble({ p, change }: { p: Placed; change: 'new' | 'changed' | null }) {
  const projects = useApp((s) => s.projects)
  const { s, x, y, scale } = p
  const { sprite, ring } = pebbleOf(s)
  const subagents = Math.min(3, s.novices.length)
  return (
    // `contents`: no box of its own, but hovering the pebble's hit area highlights the pebble.
    <div className="group/pebble contents">
      {Array.from({ length: subagents }, (_, i) => (
        <BoardPebble
          key={i}
          sprite="stone-closed"
          x={x + (62 + i * 15) * scale}
          y={y - (18 - i * 10) * scale}
          scale={scale * 0.36}
          motion={changeOf(`s:${s.id}:${i}`, '1') === 'new' ? 'land' : null}
        />
      ))}
      <HoverCard>
        <HoverCardTrigger
          delay={250}
          render={
            <button
              type="button"
              data-session-id={s.id}
              aria-label={`${nameOf(s)}, ${statusLine(s)}`}
              onClick={() => openSession(s.id)}
              className="absolute rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              style={{ left: x - 50 * scale, top: y - 70 * scale - cairnLift(s, scale), width: 100 * scale, height: 75 * scale + cairnLift(s, scale) }}
            />
          }
        />
        <HoverCardContent side="bottom" sideOffset={8} className="w-76 gap-3 p-4">
          <SessionCard s={s} agent={agentName(s, projects)} />
        </HoverCardContent>
      </HoverCard>
      <BoardPebble
        sprite={sprite}
        ring={ring}
        x={x}
        y={y}
        scale={scale}
        motion={change === 'new' ? 'land' : change === 'changed' ? 'swap' : null}
        ping={change !== null && ring === 'needs'}
        className="pointer-events-none"
        imgClassName="transition-[filter] duration-150 ease-out group-hover/pebble:brightness-110"
      />
    </div>
  )
}

/** How much higher an idle pebble sits on its cairn. */
const cairnLift = (s: SessionSummary, scale: number) => (s.status === 'idle' ? [0, 22, 58, 0, 0, 92][cairnOf(s.context)]! * scale : 0)

function SessionCard({ s, agent }: { s: SessionSummary; agent: string }) {
  const activity = s.status === 'working' ? (s.doing ?? s.activity) : s.recap?.next || s.recap?.done
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-ui font-semibold">{nameOf(s)}</span>
        <span className="truncate text-meta text-muted-foreground">
          {s.project} · {agent}
          {s.branch && <span className="font-mono"> · {s.branch}</span>}
        </span>
      </div>
      {activity && <p className="line-clamp-2 text-small text-foreground/85">{activity}</p>}
      <div className="flex gap-5">
        <Stat label="Status" value={statusLine(s)} />
        {s.context != null && <Stat label="Context" value={formatTokens(s.context)} />}
        {s.novices.length > 0 && <Stat label="Subagents" value={`${s.novices.length} running`} />}
        {s.status === 'working' && <Stat label="Running for" value={duration(s.createdAt)} />}
      </div>
      <div className="flex items-center justify-between border-t pt-3 text-meta text-muted-foreground">
        Click to open
        <Kbd>⏎</Kbd>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="truncate text-small font-semibold">{value}</span>
    </div>
  )
}

function EmptyBoard({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <BoardPebbleStatic />
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-title font-semibold">Add your first project</h2>
        <p className="text-small text-muted-foreground">
          Point Sangha at a folder or a git URL. Every Claude Code session running on it shows up here, including the ones you start in a terminal.
        </p>
      </div>
      <Button onClick={onAdd}>Add a project</Button>
    </div>
  )
}

function BoardPebbleStatic() {
  return (
    <div className="relative h-24 w-40">
      <BoardPebble sprite="stone-open" x={80} y={80} scale={1} />
    </div>
  )
}
