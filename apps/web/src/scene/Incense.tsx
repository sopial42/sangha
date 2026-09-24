import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

/**
 * An incense burner (origin: center of its base). Snuffing it out is how a priest is dismissed
 * (small burner at his feet) or a project removed (big burner before its pavilion).
 */
export function Incense({
  size = 1,
  lit,
  label,
  hint,
  hintSide = 'below',
  onSnuff,
}: {
  size?: number
  lit: boolean
  label: string
  hint: string
  /** Where the hover label goes: under the bowl, or above its smoke (when a name is written below). */
  hintSide?: 'below' | 'above'
  onSnuff: () => void
}) {
  const sticks = [-7, 0, 7]
  // Hover (or keyboard focus) wakes the burner: warm halo, a little growth, and what snuffing it will do.
  const [near, setNear] = useState(false)
  const awake = near
  // One last puff only at the moment it goes out; an incense already out never smokes.
  const wasLit = useRef(lit)
  const [puff, setPuff] = useState(false)
  useEffect(() => {
    if (wasLit.current && !lit) {
      setPuff(true)
      const t = setTimeout(() => setPuff(false), 1500)
      wasLit.current = lit
      return () => clearTimeout(t)
    }
    wasLit.current = lit
  }, [lit])
  return (
    <g
      transform={`scale(${size})`}
      onMouseEnter={() => setNear(true)}
      onMouseLeave={() => setNear(false)}
      onFocus={() => setNear(true)}
      onBlur={() => setNear(false)}
      className="incense clickable"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onSnuff()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onSnuff()
        }
      }}
    >
      <title>{label}</title>
      {/* invisible, a bit wider than the drawing itself: a comfortable tap target even at the small priest scale */}
      <rect x="-26" y="-52" width="52" height="60" fill="transparent" />
      {/* soft ground shadow: grounds the burner without any blur filter */}
      <ellipse cy="7" rx="13" ry="3" fill="#00000038" />
      {/* warm halo when awake: two layered gradients stand in for a soft blur */}
      <motion.circle cy="-13" r="30" fill="url(#incenseGlow)" initial={false} animate={{ opacity: awake ? 0.8 : 0, scale: awake ? 1 : 0.6 }} transition={{ duration: 0.3 }} />
      <motion.circle cy="-13" r="18" fill="url(#incenseGlow)" initial={false} animate={{ opacity: awake ? 1 : 0, scale: awake ? 1 : 0.6 }} transition={{ duration: 0.25 }} />
      {/* Grows like every other clickable thing in the scene: same subtle range as the moon, priests, etc. */}
      <motion.g initial={false} animate={{ scale: awake ? 1.06 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} style={{ originX: '50%', originY: '100%' }}>
      {/* tripod legs, then the censer bowl they carry */}
      {[-8, 0, 8].map((x) => (
        <path key={`leg${x}`} d={`M${x - 1.6} 2 L${x - 2.6} 8 L${x + 2.6} 8 L${x + 1.6} 2 Z`} fill="#5a4322" />
      ))}
      <ellipse cy="2" rx="15" ry="3.6" fill="#3a2c17" />
      <path d="M-15 -9 L15 -9 L11 2 L-11 2 Z" fill="url(#incenseBowl)" />
      <motion.path d="M-15 -9 L15 -9 L11 2 L-11 2 Z" fill="#ffcf88" initial={false} animate={{ opacity: awake ? 0.28 : 0 }} transition={{ duration: 0.3 }} />
      <ellipse cy="-9" rx="15" ry="3.6" fill="url(#incenseRim)" />
      {/* the ash bed the sticks stand in */}
      <ellipse cy="-9.5" rx="10.5" ry="2.4" fill="url(#incenseAsh)" />
      {/* sticks planted in the ash, their glowing tips */}
      {sticks.map((x, i) => (
        <g key={x} transform={`rotate(${(i - 1) * 9} ${x} -9)`}>
          <line x1={x} y1="-9" x2={x - 0.4} y2="-30" stroke="url(#incenseStick)" strokeWidth="1.6" strokeLinecap="round" />
          <motion.circle
            cx={x}
            cy="-31"
            r="5.5"
            fill="url(#emberGlow)"
            animate={{ opacity: lit ? [0.4, 0.85, 0.4] : 0 }}
            transition={lit ? { duration: 1.6, repeat: Infinity, delay: i * 0.3 } : { duration: 0.4 }}
          />
          <motion.circle
            cx={x}
            cy="-31"
            r="1.6"
            animate={lit ? { fill: ['#ff8a3d', '#ffd08a', '#ff8a3d'] } : { fill: '#5a5048' }}
            transition={lit ? { duration: 1.6, repeat: Infinity, delay: i * 0.3 } : { duration: 0.4 }}
          />
        </g>
      ))}
      </motion.g>
      <AnimatePresence>
        {lit &&
          sticks.map((x, i) => (
            <motion.path
              key={`smoke${x}`}
              d={`M${x + (i - 1) * 4} -33 q-5 -10 0 -20 q5 -10 0 -20`}
              fill="none"
              stroke="url(#smokeFade)"
              strokeWidth="1.4"
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: awake ? [0, 1, 0] : [0, 0.7, 0], y: [0, awake ? -18 : -12] }}
              // Its own finite transition: otherwise the exit inherits "repeat: Infinity" and the smoke never goes.
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
              transition={{ duration: awake ? 1.6 : 3.2, repeat: Infinity, delay: i * (awake ? 0.4 : 0.9) }}
            />
          ))}
        {!lit && puff && (
          <motion.path
            key="last-puff"
            d="M0 -34 q-7 -9 0 -18 q7 -9 0 -18"
            fill="none"
            stroke="url(#smokeFade)"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ opacity: 0.9, y: 0 }}
            animate={{ opacity: 0, y: -18 }}
            transition={{ duration: 1.4 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {awake && (
          // The label keeps the same size whatever the burner's size.
          <motion.g key="hint" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <g transform={hintSide === 'below' ? `translate(0 8) scale(${1 / size})` : `translate(0 -58) scale(${1 / size})`}>
              <rect
                x={-hint.length * 3.4 - 9}
                y="0"
                width={hint.length * 6.8 + 18}
                height="20"
                rx="10"
                fill="#1c0f0de6"
                stroke="#e0b25a88"
              />
              <text y="14" textAnchor="middle" className="incense-hint">
                {hint}
              </text>
            </g>
          </motion.g>
        )}
      </AnimatePresence>
    </g>
  )
}

/**
 * Gradients shared by the scene (burner hover halo, priests' waiting halo). Rendered once.
 * Gradients rather than CSS blur: Safari does not blur SVG elements.
 */
export function IncenseDefs() {
  return (
    <defs>
      <radialGradient id="priestHalo">
        <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.55" />
        <stop offset="0.6" stopColor="#ffe9a8" stopOpacity="0.25" />
        <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="incenseGlow">
        <stop offset="0" stopColor="#ffb347" stopOpacity="0.55" />
        <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
      </radialGradient>
      {/* the censer bowl: bronze, lit a little from above */}
      <linearGradient id="incenseBowl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a5884a" />
        <stop offset="0.55" stopColor="#7a6534" />
        <stop offset="1" stopColor="#5c4a26" />
      </linearGradient>
      <linearGradient id="incenseRim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d8bd7c" />
        <stop offset="1" stopColor="#93783f" />
      </linearGradient>
      <radialGradient id="incenseAsh" cx="0.5" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#6b5a3e" />
        <stop offset="1" stopColor="#382c1c" />
      </radialGradient>
      <linearGradient id="incenseStick" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#5c3a20" />
        <stop offset="1" stopColor="#8a5a34" />
      </linearGradient>
      {/* the ember's own soft glow, a gradient standing in for a blur */}
      <radialGradient id="emberGlow">
        <stop offset="0" stopColor="#ffb347" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
      </radialGradient>
      {/* a curl of smoke: dense near the stick, wisping away toward the top */}
      <linearGradient id="smokeFade" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#e8dccb" stopOpacity="0.9" />
        <stop offset="0.55" stopColor="#e8dccb" stopOpacity="0.5" />
        <stop offset="1" stopColor="#e8dccb" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}
