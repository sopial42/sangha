/** A point on the beard's chain: its position and the previous one (Verlet integration — no explicit
 *  velocity field, it falls out of `x - px` / `y - py`). */
export type Vec = { x: number; y: number }
export type BeardPoint = Vec & { px: number; py: number }

export const BEARD_LINKS = 55
export const BEARD_LINK_LEN = 7
/** Links spent falling down the chest, chin to lap, before the coil begins: exported so the drawing
 *  side can render that stretch thicker — bushy under the chin — tapering out over the rest. */
export const BEARD_DROP = 11

const GRAVITY = 55
const DAMPING = 0.88
/** How strongly a free link homes back toward its coiled slot once nothing holds it taut: strong
 *  enough that every link actually finds its own place in the coil (a weaker pull lets an inner link
 *  settle into a different, locally stable but wrong loop) and recoils well under 2 s; soft enough,
 *  combined with its fade-out below, that pulling the tip still feels like pulling a chain. */
const SPRING_K = 0.25
const CONSTRAINT_PASSES = 8
/** Below this, both in drift from rest and in speed, a link counts as back home — a little more than
 *  one screen pixel, so the sub-pixel sag gravity leaves at true equilibrium never stalls the loop. */
const SETTLE_EPS = 0.3

/**
 * Where every link sits when nothing pulls on it: point 0 at `anchor` (the chin), falling in a
 * straight line down the chest for `BEARD_DROP` links, then coiling into a big spiral resting on the
 * ground in front of him. Every angle step past the fall is solved exactly (law of cosines) so the
 * chord to the previous point is exactly `len`, whatever the current radius — so this rest shape and
 * the chain's own distance constraint (see `step`) never fight each other, and the coil holds its
 * shape instead of jittering or drifting off `rest` forever.
 */
export function beardRest(anchor: Vec, links = BEARD_LINKS, len = BEARD_LINK_LEN): Vec[] {
  const dir = { x: 0.4, y: 1 } // down and to one side, clear of his crossed legs and feet
  const n = Math.hypot(dir.x, dir.y)
  const ux = dir.x / n
  const uy = dir.y / n
  const pts: Vec[] = [{ ...anchor }]
  const drop = Math.min(BEARD_DROP, links - 2)
  for (let i = 1; i <= drop; i++) pts.push({ x: anchor.x + ux * len * i, y: anchor.y + uy * len * i })
  const center = pts[pts.length - 1]! // where the beard lands and starts coiling
  let angle = 0.4 // opens to the side, not straight back up through the fall
  let radius = len
  const growth = len * 0.1 // how much looser each successive loop sits: a big coil, 2-3 turns wide
  for (let i = drop + 1; i < links; i++) {
    if (i > drop + 1) {
      const prevRadius = radius
      radius += growth
      const cosDTheta = (prevRadius * prevRadius + radius * radius - len * len) / (2 * prevRadius * radius)
      angle += Math.acos(Math.min(1, Math.max(-1, cosDTheta)))
    }
    pts.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius })
  }
  return pts
}

/** A beard already at rest, fallen and coiled on the ground: Verlet pairs with no initial velocity. */
export function initBeard(anchor: Vec, links = BEARD_LINKS, len = BEARD_LINK_LEN): BeardPoint[] {
  return beardRest(anchor, links, len).map((p) => ({ ...p, px: p.x, py: p.y }))
}

/**
 * One physics step: Verlet integration (gravity, light damping), every free link also eased toward its
 * coiled rest slot (`rest`, from `beardRest`), the chain's own length kept by a relaxed distance
 * constraint between consecutive links, run in a few passes. Point 0 stays pinned to `rest[0]` (the
 * chin); the last point follows `drag` exactly while it's set, free to spring back the moment it isn't.
 *
 * The homing spring fades out as the tip is pulled past its coiled radius: two dozen links each
 * homing toward a *different* point of a tight coil, while the chain is stretched out straight, fight
 * the distance constraint hard enough to visibly overstretch it. Once unwound, there is nothing left
 * for the coil's own shape to usefully pull toward anyway — full strength returns only once the tip is
 * back within reach of its rest position, which is exactly when a visible homing pull is wanted.
 */
export function step(points: BeardPoint[], dt: number, rest: Vec[], drag: Vec | null): BeardPoint[] {
  const len = Math.hypot(rest[1]!.x - rest[0]!.x, rest[1]!.y - rest[0]!.y) || BEARD_LINK_LEN
  const coilRadius = Math.hypot(rest[rest.length - 1]!.x - rest[0]!.x, rest[rest.length - 1]!.y - rest[0]!.y)
  const maxReach = (rest.length - 1) * len
  const last = points[points.length - 1]!
  const tipReach = Math.hypot(last.x - rest[0]!.x, last.y - rest[0]!.y)
  const pulled = Math.min(1, Math.max(0, (tipReach - coilRadius) / Math.max(1, maxReach - coilRadius)))
  const springK = SPRING_K * (1 - pulled)
  const next = points.map((p, i) => {
    if (i === 0) return { ...rest[0]!, px: rest[0]!.x, py: rest[0]!.y }
    if (drag && i === points.length - 1) return { x: drag.x, y: drag.y, px: drag.x, py: drag.y }
    const vx = (p.x - p.px) * DAMPING
    const vy = (p.y - p.py) * DAMPING
    const r = rest[i]!
    return { x: p.x + vx + (r.x - p.x) * springK, y: p.y + vy + (r.y - p.y) * springK + GRAVITY * dt * dt, px: p.x, py: p.y }
  })
  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    for (let i = 0; i < next.length - 1; i++) {
      const a = next[i]!
      const b = next[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.0001
      const diff = (dist - len) / dist
      const moveA = i === 0 ? 0 : 0.5
      const moveB = drag && i + 1 === next.length - 1 ? 0 : 0.5
      a.x += dx * diff * moveA
      a.y += dy * diff * moveA
      b.x -= dx * diff * moveB
      b.y -= dy * diff * moveB
    }
  }
  return next
}

/** True once every link sits back on its coiled slot, barely moving: the physics loop can stop (no
 *  point re-rendering the scene 60 times a second for a beard that's already still). Always false mid-drag
 *  (the tip never matches `rest` while held away from it). */
export function isSettled(points: BeardPoint[], rest: Vec[], eps = SETTLE_EPS): boolean {
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const r = rest[i]!
    if (Math.hypot(p.x - r.x, p.y - r.y) > eps) return false
    if (Math.hypot(p.x - p.px, p.y - p.py) > eps) return false
  }
  return true
}

/** A smooth SVG path through every link of the chain (quadratic midpoints: no sharp elbows). */
export function beardPath(points: BeardPoint[]): string {
  if (!points.length) return ''
  const [first, ...rest] = points
  return rest.reduce((d, p, i) => {
    const prev = points[i]!
    const mx = (prev.x + p.x) / 2
    const my = (prev.y + p.y) / 2
    return `${d} Q ${prev.x} ${prev.y} ${mx} ${my}`
  }, `M ${first!.x} ${first!.y}`)
}

/** A glisser of 4 px or less is a click (it opens the panel); anything past that is a real attempt to
 *  pull the beard's tip, and must never open it. */
export const isDragGesture = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > 4

// `apps/web` has no vitest: this boundary is exercised here, at import time, instead of in a test file.
if (import.meta.env.DEV) {
  console.assert(isDragGesture(4, 0) === false, 'isDragGesture(4, 0) : pile 4 px doit encore être un clic')
  console.assert(isDragGesture(0, 4) === false, 'isDragGesture(0, 4) : pile 4 px (vertical) doit encore être un clic')
  console.assert(isDragGesture(2, 2) === false, 'isDragGesture(2, 2) : ~2.8 px doit être un clic')
  console.assert(isDragGesture(4.01, 0) === true, 'isDragGesture(4.01, 0) : juste au-dessus de 4 px doit être un glisser')
  console.assert(isDragGesture(3, 3) === true, 'isDragGesture(3, 3) : ~4.24 px doit être un glisser')
}
