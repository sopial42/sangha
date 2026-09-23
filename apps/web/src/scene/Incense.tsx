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
      <rect x="-16" y="-44" width="32" height="48" fill="transparent" />
      <motion.circle cy="-14" r="24" fill="url(#incenseGlow)" initial={false} animate={{ opacity: awake ? 1 : 0, scale: awake ? 1 : 0.6 }} transition={{ duration: 0.25 }} />
      <motion.g initial={false} animate={{ scale: awake ? 1.15 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} style={{ originX: '50%', originY: '100%' }}>
      {/* sticks, their ember tips, then the bowl in front */}
      {sticks.map((x, i) => (
        <g key={x} transform={`rotate(${(i - 1) * 9} ${x} -4)`}>
          <line x1={x} y1="-4" x2={x} y2="-30" stroke="#7a3a1e" strokeWidth="1.6" />
          <motion.circle
            cx={x}
            cy="-31"
            r="1.8"
            animate={lit ? { fill: ['#ff8a3d', '#ffd08a', '#ff8a3d'] } : { fill: '#5a5048' }}
            transition={lit ? { duration: 1.6, repeat: Infinity, delay: i * 0.3 } : { duration: 0.4 }}
          />
        </g>
      ))}
      <path d="M-14 -8 L14 -8 L10 3 L-10 3 Z" fill={awake ? '#8e7640' : '#7a6534'} />
      <ellipse cy="-8" rx="14" ry="3.5" fill={awake ? '#b89c56' : '#9a8446'} />
      <ellipse cy="-8" rx="10" ry="2.2" fill="#4a3f2a" />
      </motion.g>
      <AnimatePresence>
        {lit &&
          sticks.map((x, i) => (
            <motion.path
              key={`smoke${x}`}
              d={`M${x + (i - 1) * 4} -33 q-5 -10 0 -20 q5 -10 0 -20`}
              fill="none"
              stroke="#e8dccb"
              strokeWidth="1.3"
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: awake ? [0, 0.8, 0] : [0, 0.45, 0], y: [0, awake ? -18 : -12] }}
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
            stroke="#e8dccb"
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
    </defs>
  )
}
