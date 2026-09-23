import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { BUDDHA_SESSION_ID, type ProjectInfo, type SessionSummary } from '@sangha/shared'
import { openSession } from '../api'
import { agentTitle, priestsOf, robeOfAgent } from '../priests'
import { useApp } from '../store'
import { Backdrop, hallTransform } from './Backdrop'
import { Buddha } from './Buddha'
import { IncenseDefs } from './Incense'
import { AddProjectMarker, Pavilion } from './Pavilion'
import { Priest } from './Priest'

const MIN_SLOT = 230 // courtyard width of a pavilion with few priests
const PAVILION_W = 140
const PAVILION_Y = 565 // base of the first row of pavilions
const PRIESTS_BELOW = 165 // priests sit this far in front of their pavilion
const ROW_H = 420 // next row of pavilions: behind the previous row's priests, labels and novices
const BOTTOM = 290 // room under the last row for priests, their labels, context gauge and novices
const HALL_W = 1000 // Buddha's hall needs this much courtyard
const PRIEST_W = 196 // a priest with his novices, incense and recap bubble
const PRIEST_SCALE = 0.85
const TOP = 110 // empty sky above the hall, cropped out
const PER_ROW = 6

/** Width a pavilion needs so its priests sit in front of it in one readable row. */
const slotWidth = (priests: number) => Math.max(MIN_SLOT, Math.min(priests, PER_ROW) * PRIEST_W * PRIEST_SCALE + 30)

/** Seats in front of a pavilion at (cx, baseY): rows of up to PER_ROW priests. */
function seats(count: number, cx: number, baseY: number): { x: number; y: number; scale: number; bubbleSide: 1 | -1 }[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / PER_ROW)
    const inRow = Math.min(PER_ROW, count - row * PER_ROW)
    const col = i % PER_ROW
    const offset = col - (inRow - 1) / 2
    return {
      x: cx + offset * PRIEST_W * PRIEST_SCALE,
      y: baseY + PRIESTS_BELOW + row * 120,
      scale: PRIEST_SCALE,
      // His activity bubble opens away from the pavilion's own column, behind him, never toward it.
      bubbleSide: offset >= 0 ? 1 : -1,
    }
  })
}

type Placed = { x: number; y: number }

/** Pack slots into centered rows no wider than `width`. */
function pack(widths: number[], width: number): { spots: Placed[]; height: number } {
  const rows: number[][] = [[]]
  let used = 0
  widths.forEach((w, i) => {
    if (used + w > width - 40 && rows.at(-1)!.length) {
      rows.push([])
      used = 0
    }
    rows.at(-1)!.push(i)
    used += w
  })
  const spots: Placed[] = []
  rows.forEach((row, r) => {
    const total = row.reduce((a, i) => a + widths[i]!, 0)
    let x = (width - total) / 2
    for (const i of row) {
      spots[i] = { x: x + widths[i]! / 2, y: PAVILION_Y + r * ROW_H }
      x += widths[i]!
    }
  })
  return { spots, height: PAVILION_Y + (rows.length - 1) * ROW_H + BOTTOM }
}

/** Visible height of a packing (the sky above the hall is cropped). */
const shown = (p: { height: number }) => p.height - TOP

/**
 * Courtyard width that lets the scene render largest in the space it has:
 * wide rows on a wide screen, more rows on a narrow one.
 */
function arrange(widths: number[], box: { w: number; h: number }) {
  const total = widths.reduce((a, b) => a + b, 0) + 80
  const min = Math.max(HALL_W, ...widths.map((w) => w + 60), 0)
  let best: ReturnType<typeof pack> & { width: number } = { ...pack(widths, min), width: min }
  for (let width = min; width <= Math.max(min, total); width += 20) {
    const p = pack(widths, width)
    if (Math.max(width / box.w, shown(p) / box.h) < Math.max(best.width / box.w, shown(best) / box.h)) best = { ...p, width }
  }
  return best
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

export function Monastery() {
  const { sessions, projects, profiles, selectedId, view, set } = useApp()
  const priests: SessionSummary[] = priestsOf(sessions)
  const buddha = sessions[BUDDHA_SESSION_ID]

  const pavilions = [...projects]
  for (const p of priests) if (!pavilions.some((x) => x.name === p.project)) pavilions.push(orphanProject(p.project))

  // Each pavilion gets the width its priests need, packed into centered rows.
  const [svgRef, box] = useBox<SVGSVGElement>()
  const widths = pavilions.map((p) => slotWidth(priests.filter((s) => s.project === p.name).length))
  const { spots: places, width, height } = arrange(widths, box)
  // The add-project marker sits just right of the last pavilion, outside the centering.
  const last = places.at(-1)
  const marker = last ? { x: last.x + PAVILION_W / 2 + 48, y: last.y - 40 } : { x: width / 2, y: PAVILION_Y - 40 }

  const anyWorking = priests.some((p) => p.status === 'working') || buddha?.status === 'working'
  const buddhaSpeaking = selectedId === BUDDHA_SESSION_ID && view.draft.length > 0

  // Snuffing out a pavilion's big burner removes the project: always confirmed, it is a big step.
  const removeProject = async (name: string) => {
    set({ dialog: { kind: 'remove-project', name } })
    return false
  }

  const select = (id: string) => {
    if (id === selectedId) return
    openSession(id)
  }

  return (
    <svg ref={svgRef} className="scene" viewBox={`0 ${TOP} ${width} ${height - TOP}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Le monastère">
      <IncenseDefs />
      <Backdrop width={width} height={height} busy={anyWorking} />
      <g transform={hallTransform(width / 2)}>
      <Buddha
        x={500}
        busy={buddha?.status === 'working'}
        speaking={buddhaSpeaking}
        eyesOpen={buddha?.status === 'waiting'}
        selected={selectedId === BUDDHA_SESSION_ID}
        onSelect={() => select(BUDDHA_SESSION_ID)}
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
        {pavilions.flatMap((p, i) => {
          const mine = priests.filter((s) => s.project === p.name)
          const spots = seats(mine.length, places[i]!.x, places[i]!.y)
          return mine.map((s, j) => (
            <Priest
              key={s.id}
              {...spots[j]!}
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
            />
          ))
        })}
      </AnimatePresence>
    </svg>
  )
}
