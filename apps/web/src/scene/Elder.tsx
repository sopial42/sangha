import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { beardPath, beardRest, initBeard, isDragGesture, isSettled, step, type BeardPoint, type Vec } from './elderBeard'

/** Where Ananda sits: a corner of the courtyard left free of pavilions, lotus ponds and the moon. */
export function elderPosition(width: number, mobile: boolean, height: number): { x: number; y: number } {
  return mobile ? { x: 64, y: height - 92 } : { x: 112, y: height - 136 }
}

/** His chin, relative to his own seat (local to his `<g>`): where the beard's first link is pinned. */
const ANCHOR: Vec = { x: 0, y: -74 }

/** A heart-shaped leaf, point down, drawn at unit size (placed and sized by its own `transform`). */
const HEART_LEAF = 'M0 0 C -9 -9 -9 -17 0 -13 C 9 -17 9 -9 0 0 Z'

/** The Bodhi canopy's leaves, hand-placed for an organic cluster rather than a regular grid:
 *  [x, y, scale, rotation]. Fixed, not random — a random scatter would reshuffle on every render. */
const LEAVES: [number, number, number, number][] = [
  [-72, -150, 1.1, -12],
  [-50, -170, 1.3, 8],
  [-26, -180, 1.15, -6],
  [2, -184, 1.3, 3],
  [28, -177, 1.1, 11],
  [52, -166, 1.25, -9],
  [70, -147, 1.05, 15],
  [-86, -121, 0.95, 19],
  [-60, -139, 1.2, -4],
  [-34, -150, 1.1, 7],
  [-6, -154, 1.2, -11],
  [20, -151, 1.0, 13],
  [46, -140, 1.15, -15],
  [68, -123, 1.0, 6],
  [-62, -101, 0.9, 11],
  [-22, -111, 1.0, -9],
  [16, -109, 0.95, 15],
  [54, -100, 0.9, -7],
]
const LEAF_TONES = ['#5c8f4c', '#7fae5c', '#8fc06a']

/**
 * Ananda, the old sage, seated under the Bodhi tree (heart-shaped leaves), his very long white beard
 * coiled into a spiral at his chin. Pull its tip and it unwinds; let go and it springs back into its
 * coil. A pastille shows how many suggestions of his wait for a vote; a soft sage glow breathes while
 * he's meditating on a pass. Rendered in a wrapping `<g transform="translate(x y)">` by `Monastery`
 * (it carries no transform of its own, so its hover-grow can scale it directly, like a pavilion).
 */
export function Elder({ proposed, running, onOpen }: { proposed: number; running: boolean; onOpen: () => void }) {
  const reducedMotion = useReducedMotion()
  const rest = useMemo(() => beardRest(ANCHOR), [])
  const pointsRef = useRef<BeardPoint[]>(initBeard(ANCHOR))
  const [points, setPoints] = useState<BeardPoint[]>(pointsRef.current)
  const dragRef = useRef<Vec | null>(null)
  const [dragging, setDragging] = useState(false)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)

  // Only ever animates while the beard is actually held, or still easing back to its coil: not a
  // permanent 60 fps render loop for a sage who, most of the time, isn't moving at all.
  const loop = (now: number) => {
    const dt = Math.min(0.032, (now - lastRef.current) / 1000)
    lastRef.current = now
    const next = step(pointsRef.current, dt, rest, dragRef.current)
    pointsRef.current = next
    setPoints(next)
    rafRef.current = dragRef.current || !isSettled(next, rest) ? requestAnimationFrame(loop) : null
  }
  const ensureLoop = () => {
    if (rafRef.current != null) return
    lastRef.current = performance.now()
    rafRef.current = requestAnimationFrame(loop)
  }
  useEffect(() => () => void (rafRef.current != null && cancelAnimationFrame(rafRef.current)), [])

  const onTipDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.pointerType !== 'touch' && e.button !== 0) return
    const target = e.currentTarget
    const toLocal = (clientX: number, clientY: number): Vec => {
      const ctm = target.getScreenCTM()
      const svg = target.ownerSVGElement
      if (!ctm || !svg) return { x: clientX, y: clientY }
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const p = pt.matrixTransform(ctm.inverse())
      return { x: p.x, y: p.y }
    }
    const start = toLocal(e.clientX, e.clientY)
    let dragged = false
    dragRef.current = start
    setDragging(true)
    ensureLoop()
    const onMove = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY)
      if (!dragged && isDragGesture(p.x - start.x, p.y - start.y)) dragged = true
      dragRef.current = p
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
      ensureLoop() // keep easing back into the coil
      if (!dragged) onOpen() // a tap on the tip, barely moved: reads as a click
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const tip = points[points.length - 1]!
  const label = `Ananda, sous l'arbre de la Bodhi${running ? ' : il médite sur un passage' : ''}${proposed > 0 ? ` · ${proposed} suggestion${proposed > 1 ? 's' : ''} à voir` : ''}`

  return (
    <g className="elder clickable" role="button" tabIndex={0} aria-label={label} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}>
      <title>{label}</title>
      <defs>
        <radialGradient id="elderGlow">
          <stop offset="0" stopColor="#d7e8c8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#d7e8c8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bodhiTrunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a5633" />
          <stop offset="1" stopColor="#432c18" />
        </linearGradient>
        <radialGradient id="ananRobe" cx="0.4" cy="0.2" r="0.95">
          <stop offset="0" stopColor="#c9935a" />
          <stop offset="0.6" stopColor="#966a3c" />
          <stop offset="1" stopColor="#5c3c20" />
        </radialGradient>
        <radialGradient id="ananSkin" cx="0.4" cy="0.32" r="0.85">
          <stop offset="0" stopColor="#e2cdae" />
          <stop offset="0.6" stopColor="#c0a37e" />
          <stop offset="1" stopColor="#937656" />
        </radialGradient>
        <linearGradient id="ananBeard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#ece6d8" />
          <stop offset="1" stopColor="#cbc4b2" />
        </linearGradient>
      </defs>

      {/* soft sage glow while he's meditating on a pass */}
      {running &&
        (reducedMotion ? (
          <circle cy="-70" r="78" fill="url(#elderGlow)" opacity="0.7" />
        ) : (
          <motion.circle cy="-70" r="78" fill="url(#elderGlow)" animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.08, 1] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
        ))}

      {/* the Bodhi tree: a leaning trunk and a cluster of heart-shaped leaves */}
      <g className="bodhi-tree">
        <ellipse cx="2" cy="-140" rx="92" ry="54" fill="#2f4a28" opacity="0.4" />
        <path d="M-3 -4 Q-9 -46 -2 -92 Q2 -118 10 -146" fill="none" stroke="url(#bodhiTrunk)" strokeWidth="11" strokeLinecap="round" />
        <path d="M-3 -4 Q-9 -46 -2 -92 Q2 -118 10 -146" fill="none" stroke="#2a1b0e" strokeWidth="11" strokeLinecap="round" opacity="0.18" strokeDasharray="1 7" />
        {LEAVES.map(([lx, ly, s, r], i) => (
          <path key={i} d={HEART_LEAF} fill={LEAF_TONES[i % LEAF_TONES.length]} opacity="0.94" transform={`translate(${lx} ${ly}) rotate(${r}) scale(${s})`} />
        ))}
      </g>

      {/* his straw mat, grounding the seat */}
      <ellipse cy="12" rx="46" ry="11" fill="#00000040" />
      <ellipse cy="5" rx="41" ry="10" fill="#5c4a30" />
      <ellipse cy="3" rx="36" ry="8.5" fill="#6b5a3a" />
      <path d="M-30 3 Q0 8 30 3 M-26 -1 Q0 4 26 -1" fill="none" stroke="#4a3c26" strokeWidth="1" opacity="0.4" />

      {/* the old sage himself, breathing gently at rest (never while his beard is held) */}
      <motion.g
        animate={!reducedMotion && !dragging ? { rotate: [-1, 1, -1] } : { rotate: 0 }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '50%', originY: '100%' }}
      >
        {/* crossed legs under a simple, humble robe */}
        <path d="M-35 -8 Q-42 4 -27 12 Q0 20 27 12 Q42 4 35 -8 Q0 -15 -35 -8 Z" fill="url(#ananRobe)" />
        <path d="M-30 -2 Q0 4 30 -2 M-24 6 Q0 11 24 6" fill="none" stroke="#432c18" strokeWidth="1.3" opacity="0.5" strokeLinecap="round" />
        {/* one bare, aged foot resting atop the crossed legs */}
        <ellipse cx="11" cy="-7" rx="11" ry="6" fill="url(#ananSkin)" transform="rotate(-8 11 -7)" />

        {/* torso: both shoulders covered, a plain rope sash at the waist */}
        <path d="M-23 -60 Q-25 -66 -19 -68 L19 -68 Q25 -66 23 -60 L19 -12 Q0 -6 -19 -12 Z" fill="url(#ananRobe)" />
        <path d="M-14 -66 Q-2 -40 -8 -14 M14 -66 Q2 -40 8 -14" fill="none" stroke="#432c18" strokeWidth="1.3" opacity="0.4" strokeLinecap="round" />
        <path d="M-20 -30 Q0 -26 20 -30" fill="none" stroke="#3a2614" strokeWidth="2.4" opacity="0.55" strokeLinecap="round" />

        {/* sleeves, hands resting quietly in his lap */}
        <path d="M-20 -62 Q-34 -48 -30 -24 Q-27 -8 -14 -2 L-10 -8 Q-19 -16 -21 -32 Q-23 -50 -16 -60 Z" fill="url(#ananRobe)" />
        <path d="M20 -62 Q34 -48 30 -24 Q27 -8 14 -2 L10 -8 Q19 -16 21 -32 Q23 -50 16 -60 Z" fill="url(#ananRobe)" />
        <ellipse cx="-13" cy="-4" rx="8" ry="6" fill="url(#ananSkin)" />
        <ellipse cx="13" cy="-4" rx="8" ry="6" fill="url(#ananSkin)" />
        {/* a simple string of prayer beads around one wrist */}
        {[-19, -16, -13, -10, -7].map((bx) => (
          <circle key={bx} cx={bx} cy="-9" r="1.5" fill="#e3d2a8" opacity="0.9" />
        ))}

        {/* neck, long earlobes (the mark of a long-time listener) */}
        <path d="M-7 -72 L-8 -64 L8 -64 L7 -72 Z" fill="url(#ananSkin)" />
        <path d="M-15 -80 C-21 -80 -22 -71 -19 -65 C-17 -61 -16 -61 -14 -63 Z" fill="url(#ananSkin)" />
        <path d="M15 -80 C21 -80 22 -71 19 -65 C17 -61 16 -61 14 -63 Z" fill="url(#ananSkin)" />

        {/* a bald, weathered head */}
        <path d="M0 -98 C12 -98 18 -89 18 -79 C18 -66 12 -58 0 -56 C-12 -58 -18 -66 -18 -79 C-18 -89 -12 -98 0 -98 Z" fill="url(#ananSkin)" />
        <ellipse cx="-4" cy="-90" rx="7" ry="5" fill="#fff" opacity="0.14" />
        <path d="M-15 -90 Q-9 -80 -14 -70 M15 -90 Q9 -80 14 -70" fill="none" stroke="#7a6142" strokeWidth="0.8" opacity="0.4" strokeLinecap="round" />

        {/* bushy white brows over kind, half-open eyes — he is listening, not resting */}
        <path d="M-14 -83 Q-8 -87 -2 -84" fill="none" stroke="#f3efe0" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M2 -84 Q8 -87 14 -83" fill="none" stroke="#f3efe0" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M-10 -79 Q-7 -77.2 -4 -79" fill="none" stroke="#3a2a18" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M4 -79 Q7 -77.2 10 -79" fill="none" stroke="#3a2a18" strokeWidth="1.3" strokeLinecap="round" />

        {/* nose, a thin smiling mouth under a short white moustache */}
        <path d="M0 -78 Q-2.4 -72 0 -69 Q2.4 -72 0 -78 Z" fill="url(#ananSkin)" opacity="0.65" />
        <path d="M-6 -67 Q0 -64.6 6 -67" fill="none" stroke="#f3efe0" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M-4.5 -65.5 Q0 -63.6 4.5 -65.5" fill="none" stroke="#6a4a2a" strokeWidth="1" opacity="0.6" strokeLinecap="round" />

        {/* the beard: pinned at the chin, coiled at rest, its chain driven by elderBeard's physics */}
        <path d={beardPath(points)} fill="none" stroke="url(#ananBeard)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={beardPath(points)} fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity="0.35" />
        {/* generous invisible grip on the tip, a small bead so it still reads as graspable at rest */}
        <circle cx={tip.x} cy={tip.y} r="12" fill="transparent" onPointerDown={onTipDown} style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }} />
        <circle cx={tip.x} cy={tip.y} r="2.6" fill="#f7f3e6" opacity="0.95" />
      </motion.g>

      {proposed > 0 && (
        <g transform="translate(26 -94)">
          <circle r="10.5" fill="#c0392b" />
          <text y="4" textAnchor="middle" className="elder-badge-text">
            {proposed}
          </text>
        </g>
      )}
      <text y="40" textAnchor="middle" className="scene-name">
        Ananda
      </text>
    </g>
  )
}
