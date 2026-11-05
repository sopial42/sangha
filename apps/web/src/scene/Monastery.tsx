import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { BUDDHA_SESSION_ID, type ProjectInfo, type SessionSummary } from '@sangha/shared'
import { api, lotusFailure, openSession } from '../api'
import { agentTitle, priestsOf, robeOfAgent } from '../priests'
import { useApp } from '../store'
import { Backdrop, FLOOR_Y, HALL_SCALE, hallTransform } from './Backdrop'
import { Buddha } from './Buddha'
import { IncenseDefs } from './Incense'
import { LotusDragGhost, PondClosed, PondDefs, PondOpen, pondPanelSize, POND_CENTER_Y, POND_HIT_R } from './LotusPond'
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
// Each temple keeps its own lotus pond at its foot, left of the big burner on the steps, between the
// pavilion and its priests; a little smaller on mobile, where the column is narrow.
const POND_HALF_W = 92 // the pond with its priests on the bank, before scaling (see LotusPond)
const POND_SCALE = 1
const MOBILE_POND_SCALE = 0.8
const pondOffset = (scale: number) => ({ x: -(40 + POND_HALF_W * scale), y: 50 })
// Courtyard a pavilion's slot gains on its left for that pond; the pavilion shifts right by half of it.
const POND_ROOM = 90
// On mobile, the leftmost a pavilion may stand for its pond to stay on screen.
const MOBILE_PAVILION_MIN_X = -pondOffset(MOBILE_POND_SCALE).x + POND_HALF_W * MOBILE_POND_SCALE + 4

/** Rows of priests in front of a pavilion, filled evenly (7 sit 4 + 3, not 6 + 1). */
const rowsFor = (priests: number) => Math.max(1, Math.ceil(priests / PER_ROW))
const perRowFor = (priests: number) => Math.ceil(priests / rowsFor(priests))

/** Width a pavilion needs so its priests sit in front of it in one readable row. */
const slotWidth = (priests: number) => Math.max(MIN_SLOT, perRowFor(priests) * PRIEST_W * PRIEST_SCALE + 30) + POND_ROOM

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
  const reducedMotion = !!useReducedMotion()

  // The lotus pond: a drag in flight (or settling, or springing back) hides a priest a moment before
  // the server confirms it — purely local, reconciled below the instant `sessions` agrees, so the
  // drag reads as instant without ever touching the shared store.
  const [optimisticLotus, setOptimisticLotus] = useState<Set<string>>(new Set())
  const [optimisticUnlotus, setOptimisticUnlotus] = useState<Set<string>>(new Set())
  useEffect(() => {
    setOptimisticLotus((s) => {
      const n = new Set([...s].filter((id) => sessions[id] && sessions[id]!.lotus !== true))
      return n.size === s.size ? s : n
    })
    setOptimisticUnlotus((s) => {
      const n = new Set([...s].filter((id) => sessions[id] && sessions[id]!.lotus !== false))
      return n.size === s.size ? s : n
    })
  }, [sessions])
  const isLotus = (p: SessionSummary) => (p.lotus && !optimisticUnlotus.has(p.id)) || optimisticLotus.has(p.id)
  const seated = priests.filter((p) => !isLotus(p))
  const lotusPriests = priests.filter(isLotus)

  // A lotus drag's optimistic move gets reverted above on a failed save; this says why, in a small
  // transient word near the pond, until it's dismissed or fades on its own.
  const [lotusNotice, setLotusNotice] = useState<string | null>(null)
  const lotusNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (lotusNoticeTimer.current && clearTimeout(lotusNoticeTimer.current)), [])
  const noticeLotusFailure = (e: unknown) => {
    if (lotusNoticeTimer.current) clearTimeout(lotusNoticeTimer.current)
    setLotusNotice(lotusFailure(e))
    lotusNoticeTimer.current = setTimeout(() => setLotusNotice(null), 8_000)
  }

  const pavilions = [...projects]
  for (const p of priests) if (!pavilions.some((x) => x.name === p.project)) pavilions.push(orphanProject(p.project))

  // Each pavilion gets the width its priests need, packed into centered rows.
  const [svgRef, box] = useBox<SVGSVGElement>()
  // Narrow screen: pavilions stack one below the other and the page scrolls, instead of everything
  // shrinking to fit a fixed box. Matches the .scene-wrap breakpoint in styles.css.
  const mobile = box.w < 900
  const counts = pavilions.map((p) => seated.filter((s) => s.project === p.name).length)
  const widths = counts.map((n) => slotWidth(n))
  const extras = counts.map((n) => (rowsFor(n) - 1) * ROW_GAP)
  const { spots: places, width, height, ...rest } = mobile ? arrangeMobile(counts, box.w) : arrange(widths, box, extras)
  const mobilePerRow = mobile ? (rest as { perRow: 1 | 2 }).perRow : null
  // Where each pavilion stands within its slot (shifted right, its pond on its left) and where its pond
  // lies. On mobile, priests stay centered on the column; only the pavilion moves aside if it must.
  const pondScale = mobile ? MOBILE_POND_SCALE : POND_SCALE
  const pavilionAt = places.map((pl) => ({ x: mobile ? Math.max(pl.x, MOBILE_PAVILION_MIN_X) : pl.x + POND_ROOM / 2, y: pl.y }))
  const ponds = pavilionAt.map((pl) => ({ x: pl.x + pondOffset(pondScale).x, y: pl.y + pondOffset(pondScale).y }))
  // The add-project marker sits just right of the last pavilion on desktop, or as one more row on mobile.
  const last = pavilionAt.at(-1)
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
  // A drag that actually moved him suppresses the plain click that follows right after it, on
  // whichever element the pointer let go over.
  const justDraggedRef = useRef(false)
  const guardedSelect = (id: string) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    select(id)
  }

  // Every priest's seat, across all pavilions, in scene coordinates: needed once, both to render
  // them and to settle bubble sides between neighbours of different pavilions (only on desktop —
  // the mobile column stacks one priest per row, where this collision never arises).
  const seatsByPavilion = pavilions.map((p, i) => {
    const mine = seated.filter((s) => s.project === p.name)
    return { p, mine, spots: seats(mine.length, mobile ? places[i]!.x : pavilionAt[i]!.x, places[i]!.y, mobilePerRow ?? perRowFor(mine.length), mobile ? MOBILE_ROW_GAP : ROW_GAP) }
  })
  const bubbleSides = mobile
    ? {}
    : resolveBubbleSides(
        seatsByPavilion.flatMap(({ mine, spots }) => mine.map((s, j) => ({ id: s.id, x: spots[j]!.x, y: spots[j]!.y, scale: spots[j]!.scale, side: spots[j]!.bubbleSide }))),
      )

  // --- The temples' lotus ponds: open/close, and dragging a priest in or out ---------------------
  // A priest goes into his own temple's pond, and only that one: `pond` is where it lies.
  const pondOf = (project: string) => ponds[pavilions.findIndex((x) => x.name === project)] ?? { x: width / 2, y: PAVILION_Y }
  const lotusOf = (project: string) => lotusPriests.filter((p) => p.project === project)
  const [pondOpen, setPondOpen] = useState<string | null>(null)
  const openPond = pondOpen && pavilions.some((x) => x.name === pondOpen) ? pondOpen : null
  type DragPhase = 'dragging' | 'settling-in' | 'settling-out' | 'returning'
  type Drag = { id: string; project: string; pond: { x: number; y: number }; from: 'seat' | 'pond'; phase: DragPhase; x: number; y: number; overTarget: boolean; robe: string; label: string; origin: { x: number; y: number } }
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const panelRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const availPanelW = width - 40
  // The open panel grows from its pond, kept whole within the courtyard.
  const openSize = openPond ? pondPanelSize(lotusOf(openPond).length, availPanelW) : null
  const panelAt = openPond && openSize
    ? (() => {
        const at = pondOf(openPond)
        return { x: Math.min(Math.max(at.x, openSize.w / 2 + 20), width - openSize.w / 2 - 20), y: Math.max(at.y, top + openSize.h / 2 + 20) }
      })()
    : null
  if (panelAt && openSize) panelRectRef.current = { x: panelAt.x - openSize.w / 2, y: panelAt.y - openSize.h / 2, w: openSize.w, h: openSize.h }
  const updateDrag = (patch: Partial<Drag>) => {
    if (!dragRef.current) return
    const next = { ...dragRef.current, ...patch }
    dragRef.current = next
    setDrag(next)
  }
  const clearDrag = () => {
    dragRef.current = null
    setDrag(null)
  }
  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return { x: clientX, y: clientY }
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }
  const isOverPond = (p: { x: number; y: number }, pond: { x: number; y: number }) =>
    Math.hypot(p.x - pond.x, p.y - (pond.y + POND_CENTER_Y * pondScale)) <= POND_HIT_R * pondScale
  const isOverPanel = (p: { x: number; y: number }) => {
    const r = panelRectRef.current
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  }
  const settleTimer = (id: string, ms: number) => {
    setTimeout(() => {
      if (dragRef.current?.id === id) clearDrag()
    }, ms)
  }
  const finishDrag = (id: string) => {
    const d = dragRef.current
    if (!d || d.id !== id) return
    if (d.from === 'seat') {
      if (d.overTarget && !sessions[id]?.note) {
        // No note yet: back to his seat, and a word first — in the pond, it's all you'll see of him on hover.
        updateDrag({ phase: 'returning', x: d.origin.x, y: d.origin.y })
        settleTimer(id, 360)
        set({ dialog: { kind: 'note', id, lotus: true } })
      } else if (d.overTarget) {
        setOptimisticLotus((s) => new Set(s).add(id))
        updateDrag({ phase: 'settling-in', x: d.pond.x, y: d.pond.y })
        api.lotus(id, true).catch((e: unknown) => {
          setOptimisticLotus((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : s))
          noticeLotusFailure(e)
        })
        settleTimer(id, 480)
      } else {
        updateDrag({ phase: 'returning', x: d.origin.x, y: d.origin.y })
        settleTimer(id, 360)
      }
    } else {
      if (!d.overTarget) {
        // Dragged out of the panel: back onto the courtyard.
        setOptimisticUnlotus((s) => new Set(s).add(id))
        updateDrag({ phase: 'settling-out' })
        api.lotus(id, false).catch((e: unknown) => {
          setOptimisticUnlotus((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : s))
          noticeLotusFailure(e)
        })
        settleTimer(id, 420)
      } else {
        updateDrag({ phase: 'returning', x: d.origin.x, y: d.origin.y })
        settleTimer(id, 300)
      }
    }
  }
  // `isOverTarget`: for a drag out of the courtyard, his temple's pond; for a drag out of the open
  // panel, anywhere outside it — dropping back onto the panel cancels (he's released nowhere new).
  const startDrag = (e: React.PointerEvent, id: string, project: string, from: 'seat' | 'pond', robe: string, label: string, origin: { x: number; y: number }) => {
    const pond = pondOf(project)
    if (e.pointerType !== 'touch' && e.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startWorld = clientToSvg(startClientX, startClientY)
    const pointerId = e.pointerId
    const pointerType = e.pointerType
    let active = false
    let longPressTimer: ReturnType<typeof setTimeout> | undefined

    const activate = () => {
      active = true
      const d: Drag = { id, project, pond, from, phase: 'dragging', x: startWorld.x, y: startWorld.y, overTarget: from === 'seat' ? isOverPond(startWorld, pond) : !isOverPanel(startWorld), robe, label, origin }
      dragRef.current = d
      setDrag(d)
    }
    if (pointerType === 'touch') longPressTimer = setTimeout(activate, 350)

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const distClient = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY)
      if (!active) {
        if (pointerType === 'touch') {
          // Moving before the long-press fires reads as a scroll attempt, not a drag: let it be.
          if (distClient > 8 && longPressTimer) {
            clearTimeout(longPressTimer)
            longPressTimer = undefined
            cleanup()
          }
          return
        }
        if (distClient > 6) activate()
        else return
      }
      const p = clientToSvg(ev.clientX, ev.clientY)
      const overTarget = from === 'seat' ? isOverPond(p, pond) : !isOverPanel(p)
      updateDrag({ x: p.x, y: p.y, overTarget })
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      cleanup()
      if (active) {
        justDraggedRef.current = true
        setTimeout(() => (justDraggedRef.current = false), 300)
        finishDrag(id)
      }
    }
    const cleanup = () => {
      if (longPressTimer) clearTimeout(longPressTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Escape closes the pond's open panel first, same as any other overlay.
  useEffect(() => {
    if (!openPond) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPondOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPond])

  const needsAttention = (p: SessionSummary) => (p.status === 'waiting' && !p.silenced) || p.status === 'error'
  // Tall panels (many priests set aside) can reach below the courtyard's usual bottom: grow the
  // viewBox to fit rather than let it clip.
  const effectiveHeight = panelAt && openSize ? Math.max(height, panelAt.y + openSize.h / 2 + 60) : height

  return (
    <>
    <svg ref={svgRef} className="scene" viewBox={`0 ${top} ${width} ${effectiveHeight - top}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Le monastère">
      <IncenseDefs />
      <PondDefs />
      <Backdrop width={width} height={effectiveHeight} busy={anyWorking} hallScale={hallScale} />
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
        <g key={p.name} transform={`translate(${pavilionAt[i]!.x} ${pavilionAt[i]!.y})`}>
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

      {/* Each temple's closed pond, at the foot of its pavilion: a calm stack under a Bodhi tree, drawn
          before the priests so their bubbles pass over it. */}
      {pavilions.map((p, i) => {
        const mine = lotusOf(p.name)
        return (
          <PondClosed
            key={p.name}
            x={ponds[i]!.x}
            y={ponds[i]!.y}
            scale={pondScale}
            project={p.name}
            priests={mine}
            resolveTitle={(x) => agentTitle(x, projects)}
            hiddenId={drag && drag.from === 'seat' ? drag.id : null}
            needsAttention={mine.some(needsAttention)}
            dropHover={!!drag && drag.from === 'seat' && drag.project === p.name && drag.overTarget}
            reducedMotion={reducedMotion}
            onOpen={() => setPondOpen(p.name)}
          />
        )
      })}

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
              onSelect={() => guardedSelect(s.id)}
              onSelectNovice={(monkId) => {
                select(s.id)
                set({ selectedMonk: monkId })
              }}
              onIncense={() => set({ dialog: { kind: 'incense', id: s.id } })}
              onNote={() => set({ dialog: { kind: 'note', id: s.id } })}
              moon={moon}
              ackToken={closingAck?.id === s.id ? closingAck.token : undefined}
              onDragStart={(e) => startDrag(e, s.id, s.project, 'seat', robeOfAgent(s.agent), agentTitle(s, projects), { x: spots[j]!.x, y: spots[j]!.y })}
              beingDragged={drag?.id === s.id && drag.from === 'seat'}
            />
          )),
        )}
      </AnimatePresence>

      <Moon x={moon.x} y={moon.y} r={moon.r} arrivalTick={moonArrivals} onOpen={() => set({ dialog: { kind: 'nirvana' } })} />

      {/* An open pond, last of all: a panel over the whole courtyard — nothing beneath should catch a
          click meant to close it. */}
      <AnimatePresence>
        {openPond && panelAt && (
          <motion.g
            key={`pond-open-${openPond}`}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
            transition={{ duration: 0.22 }}
            style={{ originX: `${panelAt.x}px`, originY: `${panelAt.y}px` }}
          >
            <rect x={-4000} y={-4000} width={8000} height={8000} fill="#0b0810a6" onClick={() => setPondOpen(null)} />
            <PondOpen
              x={panelAt.x}
              y={panelAt.y}
              project={openPond}
              priests={lotusOf(openPond)}
              resolveTitle={(p) => agentTitle(p, projects)}
              hiddenId={drag && drag.from === 'seat' ? drag.id : null}
              draggingId={drag && drag.from === 'pond' ? drag.id : null}
              width={availPanelW}
              onSelect={(id) => guardedSelect(id)}
              onRelease={(id) => void api.lotus(id, false).catch(noticeLotusFailure)}
              onRowPointerDown={(e, id) => {
                const p = lotusPriests.find((x) => x.id === id)
                if (p) startDrag(e, id, p.project, 'pond', robeOfAgent(p.agent), agentTitle(p, projects), panelAt)
              }}
            />
          </motion.g>
        )}
      </AnimatePresence>

      {drag && (
        <LotusDragGhost
          x={drag.x}
          y={drag.y}
          robe={drag.robe}
          label={drag.label}
          valid={drag.phase !== 'dragging' || drag.overTarget}
          phase={drag.phase === 'dragging' ? 'dragging' : drag.phase === 'returning' ? 'returning' : 'settling'}
        />
      )}
    </svg>
    {lotusNotice && (
      <div className="lotus-notice" role="alert">
        <p>{lotusNotice}</p>
        <button type="button" aria-label="Fermer ce message" onClick={() => setLotusNotice(null)}>
          ×
        </button>
      </div>
    )}
    </>
  )
}
