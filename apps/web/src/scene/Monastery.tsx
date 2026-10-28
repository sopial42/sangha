import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { BUDDHA_SESSION_ID, type ProjectInfo, type SessionSummary } from '@sangha/shared'
import { openSession } from '../api'
import { agentTitle, priestsOf, robeOfAgent } from '../priests'
import { useApp } from '../store'
import { Backdrop, FLOOR_Y, HALL_SCALE, hallTransform } from './Backdrop'
import { Buddha } from './Buddha'
import { IncenseDefs } from './Incense'
import { moonPosition, Moon } from './Moon'
import { AddProjectMarker, Pavilion } from './Pavilion'
import { BUBBLE_METRICS, PRIEST_BODY_HALF, Priest } from './Priest'

const MIN_SLOT = 230 // courtyard width of a pavilion with few priests
const PAVILION_W = 140
const PAVILION_Y = 565 // base of the first row of pavilions
const PRIESTS_BELOW = 165 // priests sit this far in front of their pavilion
const ROW_H = 420 // next row of pavilions: behind the previous row's priests, labels and novices
const BOTTOM = 265 // room under the last row for priests, their labels, context gauge and novices
const HALL_W = 1000 // Buddha's hall needs this much courtyard
const PRIEST_W = 196 // a priest with his novices, incense and recap bubble
const PRIEST_SCALE = 0.85
const TOP = 110 // empty sky above the hall, cropped out (mobile reference)
// On desktop, cropped closer to the hall's roof: the courtyard, not the sky, gets the screen.
const DESKTOP_TOP = 175
const PER_ROW = 6
// Below this courtyard width, a pavilion's priests stack one per line, their bubbles narrowed
// (`compact`) to fit; above it, two columns still leave enough room for a bubble on each side.
const MOBILE_TWO_COL_MIN = 480
const MOBILE_MIN_WIDTH = 300
// Between two rows of priests: room for the back row's labels (title, branch, gauge, cost, note) and
// the front row's recap/doing bubble above him. On mobile, stacking one priest per line is the normal
// case, with taller (narrower) bubbles.
const ROW_GAP = 225
const MOBILE_ROW_GAP = 260
// Courtyard kept free at each side of the scene: the bubble of a priest at the far end opens outward.
const EDGE = 100

/** Rows of priests in front of a pavilion, filled evenly (7 sit 4 + 3, not 6 + 1). */
const rowsFor = (priests: number) => Math.max(1, Math.ceil(priests / PER_ROW))
const perRowFor = (priests: number) => Math.ceil(priests / rowsFor(priests))

/** Width a pavilion needs so its priests sit in front of it in one readable row. */
const slotWidth = (priests: number) => Math.max(MIN_SLOT, perRowFor(priests) * PRIEST_W * PRIEST_SCALE + 30)

/** Seats in front of a pavilion at (cx, baseY): rows of up to `perRow` priests, `rowGap` apart. */
function seats(count: number, cx: number, baseY: number, perRow = perRowFor(count), rowGap = ROW_GAP): { x: number; y: number; scale: number; bubbleSide: 1 | -1 }[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, count - row * perRow)
    const col = i % perRow
    const offset = col - (inRow - 1) / 2
    return {
      x: cx + offset * PRIEST_W * PRIEST_SCALE,
      y: baseY + PRIESTS_BELOW + row * rowGap,
      scale: PRIEST_SCALE,
      // His activity bubble opens away from the pavilion's own column, behind him, never toward it.
      bubbleSide: offset >= 0 ? 1 : -1,
    }
  })
}

type Placed = { x: number; y: number }

/**
 * Pack slots into centered rows no wider than `width`. `extras`: height a slot needs below a single
 * row of priests (its further rows), so the next row of pavilions starts behind all of them.
 */
function pack(widths: number[], width: number, extras: number[] = []): { spots: Placed[]; height: number } {
  const rows: number[][] = [[]]
  let used = 0
  widths.forEach((w, i) => {
    if (used + w > width - 2 * EDGE && rows.at(-1)!.length) {
      rows.push([])
      used = 0
    }
    rows.at(-1)!.push(i)
    used += w
  })
  const spots: Placed[] = []
  let y = PAVILION_Y
  let extra = 0
  rows.forEach((row, r) => {
    if (r) y += ROW_H + extra
    const total = row.reduce((a, i) => a + widths[i]!, 0)
    let x = (width - total) / 2
    for (const i of row) {
      spots[i] = { x: x + widths[i]! / 2, y }
      x += widths[i]!
    }
    extra = Math.max(0, ...row.map((i) => extras[i] ?? 0))
  })
  return { spots, height: y + BOTTOM + extra }
}

/** Visible height of a packing (the sky above the hall is cropped). */
const shown = (p: { height: number }) => p.height - DESKTOP_TOP

/**
 * Courtyard width that lets the scene render largest in the space it has:
 * wide rows on a wide screen, more rows on a narrow one.
 */
function arrange(widths: number[], box: { w: number; h: number }, extras: number[] = []) {
  const total = widths.reduce((a, b) => a + b, 0) + 2 * EDGE
  const min = Math.max(HALL_W, ...widths.map((w) => w + 2 * EDGE), 0)
  let best: ReturnType<typeof pack> & { width: number } = { ...pack(widths, min, extras), width: min }
  // Up to one step past `total`: the width that fits every pavilion on one row is always tried.
  for (let width = min; width < Math.max(min, total) + 20; width += 20) {
    const p = pack(widths, width, extras)
    if (Math.max(width / box.w, shown(p) / box.h) < Math.max(best.width / box.w, shown(best) / box.h)) best = { ...p, width }
  }
  return best
}

/**
 * Narrow-screen packing: one pavilion per row, centered, the page scrolling down instead of the
 * whole courtyard shrinking to fit. `boxWidth` becomes the courtyard width almost directly (a
 * near 1:1 mapping of SVG units to CSS pixels), so priests stay at a readable, near-native size.
 */
function arrangeMobile(counts: number[], boxWidth: number): { spots: Placed[]; width: number; height: number; perRow: 1 | 2; markerY: number } {
  const perRow = boxWidth >= MOBILE_TWO_COL_MIN ? 2 : 1
  const width = Math.max(MOBILE_MIN_WIDTH, boxWidth)
  const spots: Placed[] = []
  let y = PAVILION_Y
  for (const count of counts) {
    spots.push({ x: width / 2, y })
    const rows = Math.max(1, Math.ceil(count / perRow))
    y += ROW_H + (rows - 1) * MOBILE_ROW_GAP
  }
  // `y` now sits exactly where one more (empty) row would start: where the add-project marker goes.
  return { spots, width, height: y + 120, perRow, markerY: y }
}

/** Rendered size of an element, kept current. */
function useBox<T extends Element>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 1200, h: 900 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

// A session whose project is not loaded (removed from disk…) still needs a pavilion to sit before.
const orphanProject = (name: string): ProjectInfo => ({ name, path: '', local: true, color: '#6b6258', isGit: false, branch: null, agents: [] })

type Seated = { id: string; x: number; y: number; scale: number; side: 1 | -1 }

/** Horizontal span (world x) a bubble would occupy, opening on `side`: same geometry as `Callout`. */
function bubbleSpan(x: number, s: number, side: 1 | -1): [number, number] {
  const { w, near } = BUBBLE_METRICS.wide
  return side === 1 ? [x + near * s, x + (near + w) * s] : [x - (near + w) * s, x - near * s]
}

/** Horizontal span a priest's own body occupies, at his shoulders (the widest point of his robe). */
const bodySpan = (x: number, s: number): [number, number] => [x - PRIEST_BODY_HALF * s, x + PRIEST_BODY_HALF * s]

const spanOverlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))

/**
 * Bubbles from neighbouring priests can land stacked in the gap between two pavilions: seats() only
 * knows a priest's offset in front of his own pavilion, not who else sits at the same height nearby.
 * Here, once every priest's seat is placed in scene coordinates, group them by row and settle it:
 * left to right, each keeps his preferred side unless it collides with an already-placed bubble or a
 * neighbour's body — then he takes the other side, or whichever side collides least if both do.
 */
function resolveBubbleSides(seated: Seated[]): Record<string, 1 | -1> {
  const rows = new Map<number, Seated[]>()
  for (const p of seated) {
    const key = Math.round(p.y)
    const row = rows.get(key)
    if (row) row.push(p)
    else rows.set(key, [p])
  }
  const sides: Record<string, 1 | -1> = {}
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x)
    const bodies = sorted.map((p) => bodySpan(p.x, p.scale))
    const taken: [number, number][] = []
    sorted.forEach((p, i) => {
      const obstacles = [...taken, ...bodies.filter((_, j) => j !== i)]
      const overlapOn = (side: 1 | -1) => {
        const span = bubbleSpan(p.x, p.scale, side)
        return obstacles.reduce((worst, o) => Math.max(worst, spanOverlap(span, o)), 0)
      }
      const preferred = overlapOn(p.side)
      const chosen = preferred > 0 && overlapOn(p.side === 1 ? -1 : 1) < preferred ? (p.side === 1 ? -1 : 1) : p.side
      sides[p.id] = chosen
      taken.push(bubbleSpan(p.x, p.scale, chosen))
    })
  }
  return sides
}

export function Monastery() {
  const { sessions, projects, profiles, selectedId, view, set, moonArrivals, closing, closingAck } = useApp()
  const priests: SessionSummary[] = priestsOf(sessions)
  const buddha = sessions[BUDDHA_SESSION_ID]

  const pavilions = [...projects]
  for (const p of priests) if (!pavilions.some((x) => x.name === p.project)) pavilions.push(orphanProject(p.project))

  // Each pavilion gets the width its priests need, packed into centered rows.
  const [svgRef, box] = useBox<SVGSVGElement>()
  // Narrow screen: pavilions stack one below the other and the page scrolls, instead of everything
  // shrinking to fit a fixed box. Matches the .scene-wrap breakpoint in styles.css.
  const mobile = box.w < 900
  const counts = pavilions.map((p) => priests.filter((s) => s.project === p.name).length)
  const widths = counts.map((n) => slotWidth(n))
  const extras = counts.map((n) => (rowsFor(n) - 1) * ROW_GAP)
  const { spots: places, width, height, ...rest } = mobile ? arrangeMobile(counts, box.w) : arrange(widths, box, extras)
  const mobilePerRow = mobile ? (rest as { perRow: 1 | 2 }).perRow : null
  // The add-project marker sits just right of the last pavilion on desktop, or as one more row on mobile.
  const last = places.at(-1)
  const marker = mobile
    ? { x: width / 2, y: (rest as { markerY: number }).markerY }
    : last
      ? { x: last.x + PAVILION_W / 2 + 48, y: last.y - 40 }
      : { x: width / 2, y: PAVILION_Y - 40 }
  // On mobile, the hall shrinks with the courtyard (never wider than it), and the sky crops tighter
  // to match: less empty space above a smaller hall.
  const hallScale = mobile ? Math.max(0.4, Math.min(HALL_SCALE, width / 620)) : HALL_SCALE
  const top = mobile ? Math.round(FLOOR_Y - (FLOOR_Y - TOP) * (hallScale / HALL_SCALE)) : DESKTOP_TOP
  const moon = moonPosition(width, mobile, top)

  const anyWorking = priests.some((p) => p.status === 'working') || buddha?.status === 'working'
  const buddhaSpeaking = selectedId === BUDDHA_SESSION_ID && view.draft.length > 0

  // Snuffing out a pavilion's big burner removes the project: always confirmed, it is a big step.
  const removeProject = async (name: string) => {
    set({ dialog: { kind: 'remove-project', name } })
    return false
  }

  const select = (id: string) => {
    // Reselecting while his panel is mid-close still has to cancel that close, not be a no-op.
    if (id === selectedId && !closing) return
    openSession(id)
  }

  // Every priest's seat, across all pavilions, in scene coordinates: needed once, both to render
  // them and to settle bubble sides between neighbours of different pavilions (only on desktop —
  // the mobile column stacks one priest per row, where this collision never arises).
  const seatsByPavilion = pavilions.map((p, i) => {
    const mine = priests.filter((s) => s.project === p.name)
    return { p, mine, spots: seats(mine.length, places[i]!.x, places[i]!.y, mobilePerRow ?? perRowFor(mine.length), mobile ? MOBILE_ROW_GAP : ROW_GAP) }
  })
  const bubbleSides = mobile
    ? {}
    : resolveBubbleSides(
        seatsByPavilion.flatMap(({ mine, spots }) => mine.map((s, j) => ({ id: s.id, x: spots[j]!.x, y: spots[j]!.y, scale: spots[j]!.scale, side: spots[j]!.bubbleSide }))),
      )

  return (
    <svg ref={svgRef} className="scene" viewBox={`0 ${top} ${width} ${height - top}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Le monastère">
      <IncenseDefs />
      <Backdrop width={width} height={height} busy={anyWorking} hallScale={hallScale} />
      <g transform={hallTransform(width / 2, hallScale)}>
      <Buddha
        x={500}
        busy={buddha?.status === 'working'}
        speaking={buddhaSpeaking}
        eyesOpen={buddha?.status === 'waiting'}
        selected={selectedId === BUDDHA_SESSION_ID}
        onSelect={() => select(BUDDHA_SESSION_ID)}
        ackToken={closingAck?.id === BUDDHA_SESSION_ID ? closingAck.token : undefined}
      />
      </g>

      {pavilions.map((p, i) => (
        <g key={p.name} transform={`translate(${places[i]!.x} ${places[i]!.y})`}>
          <Pavilion
            project={p}
            width={PAVILION_W}
            working={priests.some((s) => s.project === p.name && s.status === 'working')}
            onClick={() => p.path && set({ dialog: { kind: 'new-session', project: p.name } })}
            onRemove={!p.path ? undefined : () => removeProject(p.name)}
          />
        </g>
      ))}
      <g transform={`translate(${marker.x} ${marker.y})`}>
        <AddProjectMarker onClick={() => set({ dialog: { kind: 'add-project' } })} />
      </g>

      <AnimatePresence>
        {seatsByPavilion.flatMap(({ mine, spots }) =>
          mine.map((s, j) => (
            <Priest
              key={s.id}
              {...spots[j]!}
              bubbleSide={bubbleSides[s.id] ?? spots[j]!.bubbleSide}
              compact={mobile}
              session={s}
              robe={robeOfAgent(s.agent)}
              title={agentTitle(s, projects)}
              profiles={profiles}
              selected={s.id === selectedId}
              onSelect={() => select(s.id)}
              onSelectNovice={(monkId) => {
                select(s.id)
                set({ selectedMonk: monkId })
              }}
              onIncense={() => set({ dialog: { kind: 'incense', id: s.id } })}
              onNote={() => set({ dialog: { kind: 'note', id: s.id } })}
              moon={moon}
              ackToken={closingAck?.id === s.id ? closingAck.token : undefined}
            />
          )),
        )}
      </AnimatePresence>

      {/* Last: above every other layer, so nothing sky- or hall-shaped can steal its clicks. */}
      <Moon x={moon.x} y={moon.y} r={moon.r} arrivalTick={moonArrivals} onOpen={() => set({ dialog: { kind: 'nirvana' } })} />
    </svg>
  )
}
