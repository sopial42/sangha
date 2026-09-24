import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

/**
 * Where the moon sits in scene coordinates, `width` wide (mobile stacks pavilions, so it needs its
 * own smaller, higher spot clear of the shrunken hall). Shared by `Moon` itself and by every priest's
 * exit flight, which targets these exact coordinates.
 */
export function moonPosition(width: number, mobile: boolean, top: number): { x: number; y: number; r: number } {
  return mobile ? { x: Math.max(width * 0.6, width - 70), y: Math.max(70, top + 36), r: 20 } : { x: width - 160, y: 170, r: 30 }
}

/**
 * The moon: where priests sent to nirvana end up. Clickable and focusable, glowing softly on hover
 * and briefly pulsing whenever the moon's history changes (a priest arrives, or is reincarnated).
 * Rendered last among the scene's top-level elements so nothing sky- or hall-shaped can sit above it
 * and steal its clicks.
 */
export function Moon({ x, y, r, tick, onOpen }: { x: number; y: number; r: number; tick: number; onOpen: () => void }) {
  const [hot, setHot] = useState(false)
  const [pulsing, setPulsing] = useState(false)
  const firstTick = useRef(true)

  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false
      return
    }
    // A priest's flight takes a few seconds: the glow lands roughly when he does, not the instant he leaves.
    const delay = setTimeout(() => {
      setPulsing(true)
      const off = setTimeout(() => setPulsing(false), 1100)
      return () => clearTimeout(off)
    }, 2600)
    return () => clearTimeout(delay)
  }, [tick])

  return (
    <g
      transform={`translate(${x} ${y})`}
      className="moon clickable"
      role="button"
      tabIndex={0}
      aria-label="Nirvana : historique des prêtres"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <title>Nirvana : historique des prêtres</title>
      <defs>
        <radialGradient id="moonGlow">
          <stop offset="0" stopColor="#f6e3b4" stopOpacity="0.85" />
          <stop offset="1" stopColor="#f6e3b4" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* generous invisible tap target, well past the disc itself */}
      <circle r={r + 24} fill="transparent" />
      <motion.circle
        r={r * 2.4}
        fill="url(#moonGlow)"
        initial={false}
        animate={{ opacity: pulsing ? 0.95 : hot ? 0.75 : 0.3, scale: pulsing ? 1.35 : hot ? 1.15 : 1 }}
        transition={{ duration: pulsing ? 0.5 : 0.3, ease: 'easeOut' }}
      />
      <motion.circle
        r={r}
        fill="#f6e3b4"
        initial={false}
        animate={{ opacity: pulsing ? [0.85, 1, 0.85] : 0.88, scale: hot ? 1.06 : 1 }}
        transition={pulsing ? { duration: 0.55, repeat: 1 } : { duration: 0.25 }}
      />
      {/* a soft crescent shadow: it reads as a moon, not a sun */}
      <circle cx={r * 0.32} cy={-r * 0.22} r={r * 0.78} fill="#1b1733" opacity="0.22" />
      <AnimatePresence>
        {hot && (
          <motion.g key="hint" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <g transform={`translate(0 ${r + 20})`}>
              <rect x={-32} y="0" width="64" height="20" rx="10" fill="#1c0f0de6" stroke="#e0b25a88" />
              <text y="14" textAnchor="middle" className="incense-hint">
                Nirvana
              </text>
            </g>
          </motion.g>
        )}
      </AnimatePresence>
    </g>
  )
}
