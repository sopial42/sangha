import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BEARD_DROP, beardPath, beardRest, initBeard, isDragGesture, isSettled, step, type BeardPoint, type Vec } from './elderBeard'

/** Where Ananda sits: a corner of the courtyard left free of pavilions, lotus ponds and the moon.
 *  `scale`: shrinks him (and his canopy) to fit a narrow phone screen without running off its edge. */
export function elderPosition(width: number, mobile: boolean, height: number): { x: number; y: number; scale: number } {
  return mobile ? { x: 76, y: height - 70, scale: 0.6 } : { x: 128, y: height - 132, scale: 1 }
}

/** His chin, relative to his own seat (local to his `<g>`): where the beard falls from. */
const ANCHOR: Vec = { x: 0, y: -62 }

/** A heart-shaped leaf, point down, drawn at unit size (placed and sized by its own `transform`). */
const HEART_LEAF = 'M0 0 C -9 -9 -9 -17 0 -13 C 9 -17 9 -9 0 0 Z'

/** The Bodhi canopy's leaves, scattered across its foliage masses — hand-placed, not random (a random
 *  scatter would reshuffle on every render): [x, y, scale, rotation]. */
const LEAVES: [number, number, number, number][] = [
  [-78, -188, 1.15, -12],
  [-54, -210, 1.3, 8],
  [-28, -222, 1.2, -6],
  [2, -226, 1.3, 3],
  [30, -218, 1.15, 11],
  [56, -204, 1.25, -9],
  [76, -182, 1.05, 15],
  [-92, -158, 0.95, 19],
  [-64, -178, 1.2, -4],
  [-36, -192, 1.1, 7],
  [-8, -198, 1.2, -11],
  [20, -195, 1.0, 13],
  [48, -184, 1.15, -15],
  [72, -162, 1.0, 6],
  [-70, -138, 0.9, 11],
  [-26, -150, 1.0, -9],
  [14, -148, 0.95, 15],
  [50, -140, 0.9, -7],
  [-10, -168, 1.1, 2],
  [30, -158, 1.0, -13],
]
const LEAF_TONES = ['#4f7f41', '#6fa15a', '#86c06a']

export function Elder({ proposed, running, onOpen }: { proposed: number; running: boolean; onOpen: () => void }) {
  const reducedMotion = useReducedMotion()
  const rest = useMemo(() => beardRest(ANCHOR), [])
  const pointsRef = useRef<BeardPoint[]>(initBeard(ANCHOR))
  const [points, setPoints] = useState<BeardPoint[]>(pointsRef.current)
  const dragRef = useRef<Vec | null>(null)
  const [dragging, setDragging] = useState(false)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  // Pointer capture (below) makes the browser's own synthesized "click" fire on the grip circle no
  // matter how far the pointer actually moved before it was released: without this guard, letting go
  // after a real drag would also open the panel, the same false-click Monastery already guards against
  // when a priest is dragged into his lotus pond.
  const justDraggedRef = useRef(false)

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
    // Without this, the browser reads the move that follows as a text-drag-select over whatever sits
    // under the pointer next (a scene label, the add-project "+"…), instead of our own drag.
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
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
    const onUp = (ev: PointerEvent) => {
      dragRef.current = null
      setDragging(false)
      ensureLoop() // keep easing back into the coil
      if (!dragged) onOpen() // a tap on the tip, barely moved: reads as a click
      else {
        justDraggedRef.current = true
        setTimeout(() => (justDraggedRef.current = false), 300)
      }
      target.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const open = () => {
    if (justDraggedRef.current) return // the click the browser synthesizes after releasing capture
    onOpen()
  }

  const tip = points[points.length - 1]!
  const label = `Ananda, sous l'arbre de la Bodhi${running ? ' : il médite sur un passage' : ''}${proposed > 0 ? ` · ${proposed} suggestion${proposed > 1 ? 's' : ''} à voir` : ''}`

  return (
    <g className="elder clickable" role="button" tabIndex={0} aria-label={label} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}>
      <title>{label}</title>
      <defs>
        <radialGradient id="elderGlow">
          <stop offset="0" stopColor="#d7e8c8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#d7e8c8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bodhiTrunk" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#8a6440" />
          <stop offset="0.55" stopColor="#5e3f24" />
          <stop offset="1" stopColor="#3a2614" />
        </linearGradient>
        <radialGradient id="ananRobe" cx="0.4" cy="0.2" r="0.95">
          <stop offset="0" stopColor="#dba05f" />
          <stop offset="0.55" stopColor="#c07b3a" />
          <stop offset="1" stopColor="#7a4e23" />
        </radialGradient>
        <radialGradient id="ananRobeShade" cx="0.4" cy="0.1" r="1">
          <stop offset="0" stopColor="#c6903f" />
          <stop offset="0.6" stopColor="#a06a2e" />
          <stop offset="1" stopColor="#5c3c1c" />
        </radialGradient>
        <radialGradient id="ananSkin" cx="0.4" cy="0.32" r="0.85">
          <stop offset="0" stopColor="#e9d4b4" />
          <stop offset="0.6" stopColor="#caa87e" />
          <stop offset="1" stopColor="#9c7b57" />
        </radialGradient>
        <radialGradient id="ananHead" cx="0.4" cy="0.26" r="0.85">
          <stop offset="0" stopColor="#edddc0" />
          <stop offset="0.6" stopColor="#caa87e" />
          <stop offset="1" stopColor="#a2805c" />
        </radialGradient>
        <linearGradient id="ananBeard" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#ece6d8" />
          <stop offset="1" stopColor="#cbc4b2" />
        </linearGradient>
      </defs>

      {/* soft sage glow while he's meditating on a pass */}
      {running &&
        (reducedMotion ? (
          <circle cy="-90" r="90" fill="url(#elderGlow)" opacity="0.7" />
        ) : (
          <motion.circle cy="-90" r="90" fill="url(#elderGlow)" animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.08, 1] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
        ))}

      {/* the Bodhi tree: Ananda sits at its foot, the trunk standing beside him (never behind his own
          head) and its canopy — several overlapping masses of heart-shaped leaves, not one flat blob —
          spreading wide above and around him, the way he'd actually be sheltered by it. */}
      <g className="bodhi-tree">
        {/* roots flaring into the ground */}
        <path d="M-46 4 Q-50 -6 -40 -12" fill="none" stroke="url(#bodhiTrunk)" strokeWidth="7" strokeLinecap="round" />
        <path d="M-34 8 Q-34 -4 -38 -14" fill="none" stroke="url(#bodhiTrunk)" strokeWidth="8" strokeLinecap="round" />
        <path d="M-22 5 Q-26 -4 -34 -13" fill="none" stroke="url(#bodhiTrunk)" strokeWidth="6.5" strokeLinecap="round" />
        {/* the trunk itself: gnarled, leaning, offset to his side so it never runs up through his head */}
        <path d="M-38 -10 Q-46 -36 -40 -62 Q-34 -92 -44 -118 Q-48 -140 -34 -162 Q-26 -178 -14 -192" fill="none" stroke="url(#bodhiTrunk)" strokeWidth="15" strokeLinecap="round" />
        <path d="M-38 -10 Q-46 -36 -40 -62 Q-34 -92 -44 -118 Q-48 -140 -34 -162 Q-26 -178 -14 -192" fill="none" stroke="#2a1b0e" strokeWidth="15" strokeLinecap="round" opacity="0.14" strokeDasharray="1 9" />
        {/* a few bark knots */}
        <ellipse cx="-43" cy="-58" rx="4" ry="5.5" fill="#2a1b0e" opacity="0.3" transform="rotate(20 -43 -58)" />
        <ellipse cx="-38" cy="-128" rx="3.5" ry="5" fill="#2a1b0e" opacity="0.3" transform="rotate(-15 -38 -128)" />
        {/* canopy: back masses (darker, deeper) first, the sunlit top mass last */}
        <path d="M-96 -170 Q-104 -210 -64 -224 Q-30 -236 2 -222 Q-20 -200 -30 -176 Q-64 -158 -96 -170 Z" fill="#355a2c" opacity="0.92" />
        <path d="M26 -176 Q10 -206 36 -228 Q66 -246 92 -224 Q104 -204 90 -182 Q64 -162 26 -176 Z" fill="#3c6530" opacity="0.92" />
        <path d="M-56 -150 Q-72 -176 -44 -192 Q-14 -206 14 -196 Q4 -174 -10 -160 Q-34 -142 -56 -150 Z" fill="#45713a" opacity="0.94" />
        <path d="M-14 -200 Q-34 -232 4 -248 Q44 -260 70 -236 Q78 -216 58 -200 Q22 -184 -14 -200 Z" fill="#5a8a48" opacity="0.95" />
        <path d="M10 -158 Q-6 -184 24 -196 Q56 -206 78 -188 Q84 -170 64 -156 Q36 -144 10 -158 Z" fill="#5a8a48" opacity="0.9" />
        {LEAVES.map(([lx, ly, s, r], i) => (
          <path key={i} d={HEART_LEAF} fill={LEAF_TONES[i % LEAF_TONES.length]} opacity="0.95" transform={`translate(${lx} ${ly}) rotate(${r}) scale(${s})`} />
        ))}
      </g>

      {/* his straw mat, grounding the seat — wide enough that the beard's coil also rests on it */}
      <ellipse cy="18" rx="58" ry="13" fill="#00000040" />
      <ellipse cy="9" rx="52" ry="12" fill="#5c4a30" />
      <ellipse cy="6" rx="45" ry="10" fill="#6b5a3a" />
      <path d="M-36 6 Q0 12 36 6 M-30 2 Q0 7 30 2" fill="none" stroke="#4a3c26" strokeWidth="1" opacity="0.4" />

      {/* the old sage himself, breathing gently at rest (never while his beard is held) */}
      <motion.g
        animate={!reducedMotion && !dragging ? { rotate: [-1, 1, -1] } : { rotate: 0 }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '50%', originY: '100%' }}
      >
        {/* His whole body, at Buddha's own proportions scaled down by 0.55 (chin lands exactly on
            `ANCHOR`): a wide crossed-leg seat, a torso robed over one shoulder, the other arm bare —
            skin against robe is what reads as an actual body, not a barrel. */}
        <g transform="scale(0.55)">
          {/* crossed legs under his robe */}
          <path d="M-72 -22 Q-80 -6 -66 6 Q-40 16 0 17 Q40 16 66 6 Q80 -6 72 -22 Q40 -26 0 -26 Q-40 -26 -72 -22 Z" fill="url(#ananRobeShade)" />
          <path d="M-52 -19 Q0 -24 52 -19" fill="none" stroke="#4a3018" strokeWidth="2.2" opacity="0.45" strokeLinecap="round" />
          <path d="M-64 -10 Q0 -16 64 -10" fill="none" stroke="#4a3018" strokeWidth="2.2" opacity="0.4" strokeLinecap="round" />
          {/* one bare, aged foot resting atop the crossed legs */}
          <ellipse cx="14" cy="-8" rx="15" ry="8" fill="url(#ananSkin)" transform="rotate(-9 14 -8)" />
          <path d="M4 -8 Q11 -12 18 -10 M7 -3 Q13 -7 20 -5" fill="none" stroke="#8a6a46" strokeWidth="1.1" opacity="0.5" strokeLinecap="round" />

          {/* torso: robed on his right (our left), one shoulder bare on his left (our right) */}
          <path d="M-45 -96 Q-40 -104 -30 -104 L30 -104 Q40 -104 45 -96 L33 -26 Q30 -20 20 -18 L-20 -18 Q-30 -20 -33 -26 Z" fill="url(#ananRobe)" />
          <path d="M-4 -12 Q10 -30 12 -60 Q13 -80 4 -94" fill="none" stroke="#5c3c1c" strokeWidth="2.2" opacity="0.45" strokeLinecap="round" />
          {/* the sash: a diagonal fold crossing the chest, reading as "drapé" */}
          <path d="M25 -99 Q4 -70 -18 -30" fill="none" stroke="#5c3c1c" strokeWidth="3.4" opacity="0.5" strokeLinecap="round" />
          <path d="M33 -94 Q13 -66 -9 -26" fill="none" stroke="#6b4a24" strokeWidth="2.4" opacity="0.4" strokeLinecap="round" />

          {/* his bare shoulder and arm, hand resting near his knee */}
          <path d="M-42 -96 Q-58 -80 -55 -52 Q-52 -28 -34 -12 Q-22 -3 -10 -6 Q-22 -16 -27 -32 Q-32 -52 -27 -74 Q-35 -86 -42 -96 Z" fill="url(#ananSkin)" />
          <path d="M-36 -92 Q-28 -58 -25 -28" fill="none" stroke="#8a6a46" strokeWidth="1.3" opacity="0.4" strokeLinecap="round" />
          <ellipse cx="-14" cy="-8" rx="13" ry="9" fill="url(#ananSkin)" />
          {/* a simple string of prayer beads around that wrist */}
          {[-26, -19, -12, -5].map((bx) => (
            <circle key={bx} cx={bx} cy="-15" r="2.6" fill="#e3d2a8" opacity="0.9" />
          ))}

          {/* neck, long earlobes (the mark of a long-time listener) */}
          <path d="M-9.5 -118 Q-10 -109 -12 -104 L12 -104 Q10 -109 9.5 -118 Z" fill="url(#ananSkin)" />
          <path d="M-17 -148 C-25 -150 -27 -139 -25 -131 C-24 -125 -24 -119 -19.5 -118 C-16 -118.5 -15 -122 -14 -126 Z" fill="url(#ananSkin)" />
          <path d="M17 -148 C25 -150 27 -139 25 -131 C24 -125 24 -119 19.5 -118 C16 -118.5 15 -122 14 -126 Z" fill="url(#ananSkin)" />

          {/* a bald, weathered head, left fully clear for his face */}
          <path d="M0 -168 C13 -168 20 -159 20 -147 C20 -131 13 -115 0 -113 C-13 -115 -20 -131 -20 -147 C-20 -159 -13 -168 0 -168 Z" fill="url(#ananHead)" />
          <ellipse cx="-6" cy="-155" rx="7" ry="5" fill="#fff" opacity="0.16" />

          {/* bushy white brows, drooping at their outer ends — an old sage's, not a young one's */}
          <path d="M-2.5 -144.5 Q-7.5 -147 -13 -143.5 Q-15.5 -141.5 -15 -138.5" fill="none" stroke="#f3efe0" strokeWidth="4.2" strokeLinecap="round" />
          <path d="M2.5 -144.5 Q7.5 -147 13 -143.5 Q15.5 -141.5 15 -138.5" fill="none" stroke="#f3efe0" strokeWidth="4.2" strokeLinecap="round" />
          {/* eyes closed in peace */}
          <path d="M-11 -139 Q-7 -136.3 -3 -139" fill="none" stroke="#5c4228" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M3 -139 Q7 -136.3 11 -139" fill="none" stroke="#5c4228" strokeWidth="2.3" strokeLinecap="round" />

          {/* nose, and a calm closed mouth under a short white moustache */}
          <path d="M0 -133 Q-4.5 -124 0 -118 Q4.5 -124 0 -133 Z" fill="url(#ananSkin)" opacity="0.6" />
          <path d="M-11 -116 Q0 -112.3 11 -116" fill="none" stroke="#f3efe0" strokeWidth="3.3" strokeLinecap="round" />
          <path d="M-8 -113.5 Q0 -111 8 -113.5" fill="none" stroke="#6a4a2a" strokeWidth="1.7" opacity="0.6" strokeLinecap="round" />
        </g>

        {/* the beard: thick and bushy right under the chin (several layered strands), tapering as it
            falls down his chest and coils into a big spiral resting on the mat in front of him — its
            chain driven by elderBeard's physics */}
        <path d={beardPath(points)} fill="none" stroke="#00000030" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(1.6 2.2)" />
        <path d={beardPath(points)} fill="none" stroke="url(#ananBeard)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={beardPath(points.slice(0, Math.ceil(points.length * 0.6)))} fill="none" stroke="url(#ananBeard)" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={beardPath(points.slice(0, BEARD_DROP + 3))} fill="none" stroke="url(#ananBeard)" strokeWidth="7.6" strokeLinecap="round" strokeLinejoin="round" />
        {/* a couple of extra locks parting from the main mass, for a "touffue" (bushy), many-stranded chin */}
        <path
          d={beardPath(points.slice(0, BEARD_DROP + 2).map((p, i) => (i < 3 ? p : { ...p, x: p.x - 3.4, y: p.y - 0.6 })))}
          fill="none"
          stroke="url(#ananBeard)"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d={beardPath(points.slice(0, BEARD_DROP + 2).map((p, i) => (i < 3 ? p : { ...p, x: p.x + 3.8, y: p.y - 0.3 })))}
          fill="none"
          stroke="url(#ananBeard)"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.8"
        />
        {/* a bright, thin sheen along its full length */}
        <path d={beardPath(points)} fill="none" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
        {/* a generous, invisible grip along its last third — forgiving to grab, not just its very tip */}
        {points.slice(Math.floor(points.length * 0.7)).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="15" fill="transparent" onPointerDown={onTipDown} style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }} />
        ))}
        {/* a small bead right at the tip, so it still reads as graspable at rest — never a hit target
            itself: sitting exactly on top of the grip circles, it would otherwise steal the very
            pointerdown they exist to catch. */}
        <circle cx={tip.x} cy={tip.y} r="2.8" fill="#f7f3e6" opacity="0.95" style={{ pointerEvents: 'none' }} />
      </motion.g>

      {proposed > 0 && (
        <g transform="translate(30 -98)">
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
