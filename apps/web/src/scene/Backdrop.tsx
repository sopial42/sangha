import { motion } from 'motion/react'

export const FLOOR_Y = 400
/** Buddha's hall is drawn a bit smaller, from the floor line up, to leave room to the pavilions. */
export const HALL_SCALE = 0.82
/** `scale` lets a narrow courtyard (mobile) shrink the hall further, so it never outgrows the width it has. */
export const hallTransform = (cx: number, scale = HALL_SCALE) => `translate(${cx} ${FLOOR_Y}) scale(${scale}) translate(-500 -${FLOOR_Y})`

/** A mountain ridge from far left to far right: peaks around `base`, `amp` high, down to the floor. */
function ridge(width: number, base: number, amp: number, phase: number): string {
  const pts: string[] = []
  for (let x = -3000; x <= width + 3000; x += 90) {
    const y = base - amp * (0.55 * Math.sin(x / 170 + phase) + 0.45 * Math.sin(x / 67 + phase * 2)) * 0.5 - amp * 0.3
    pts.push(`${x} ${Math.round(y)}`)
  }
  return `M${pts.join(' L')} L${width + 3000} ${FLOOR_Y + 20} L-3000 ${FLOOR_Y + 20} Z`
}

/**
 * Courtyard at dusk, `width` wide: the sky and floor stretch, Buddha's hall stays centered.
 * Only the lanterns and incense react to activity.
 */
export function Backdrop({ width, height, busy, hallScale = HALL_SCALE }: { width: number; height: number; busy: boolean; hallScale?: number }) {
  const cx = width / 2
  return (
    <g>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1733" />
          <stop offset="0.55" stopColor="#4a2c40" />
          <stop offset="1" stopColor="#c07a45" />
        </linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b4636" />
          <stop offset="1" stopColor="#2a2019" />
        </linearGradient>
        <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a1f1a" />
          <stop offset="1" stopColor="#1c0f0d" />
        </linearGradient>
        <radialGradient id="lanternGlow">
          <stop offset="0" stopColor="#ffb347" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky and floor overflow the frame so the letterbox around the scene is scenery too. */}
      <rect x={-3000} y={-2000} width={width + 6000} height={FLOOR_Y + 2000} fill="#1b1733" />
      <rect x={-3000} y={0} width={width + 6000} height={FLOOR_Y} fill="url(#sky)" />
      <rect x={-3000} y={FLOOR_Y} width={width + 6000} height={height - FLOOR_Y + 3000} fill="#2a2019" />
      <circle cx={width - 160} cy="170" r="30" fill="#f6e3b4" opacity="0.85" />

      {/* distant mountains: two continuous ridges, far beyond the frame on both sides */}
      <path d={ridge(width, 300, 70, 0)} fill="#2b2238" opacity="0.8" />
      <path d={ridge(width, 345, 45, 2.1)} fill="#231b2c" />
      {/* floor, stretched to the courtyard's width */}
      <g transform={`scale(${width / 1000} 1)`}>
        <path d={`M-3000 ${FLOOR_Y} L4000 ${FLOOR_Y} L4000 ${height} L-3000 ${height} Z`} fill="url(#floor)" />
        {/* paving joints, wider apart as they come closer */}
        {Array.from({ length: 30 }, (_, i) => FLOOR_Y + 40 * i + 6 * i * i)
          .filter((y) => y > FLOOR_Y && y < height)
          .map((y) => (
            <line key={y} x1="-3000" x2="4000" y1={y} y2={y} stroke="#00000033" strokeWidth="1.5" />
          ))}
      </g>
      {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
        <line key={k} x1={cx + k * 150} y1={FLOOR_Y} x2={cx + k * (150 + (height - FLOOR_Y) * 0.4)} y2={height} stroke="#00000022" strokeWidth="1.5" />
      ))}

      {/* Buddha's hall */}
      <g transform={hallTransform(cx, hallScale)}>
        <rect x="250" y="170" width="500" height="230" fill="#2a1712" />
        <rect x="280" y="190" width="440" height="210" fill="#3b2019" />
        {[270, 360, 640, 730].map((x) => (
          <rect key={x} x={x - 9} y="175" width="18" height="225" fill="#9e2b22" />
        ))}
        <path d="M170 185 Q230 170 250 140 L750 140 Q770 170 830 185 L800 160 Q760 150 740 110 L260 110 Q240 150 200 160 Z" fill="url(#roof)" />
        <path d="M230 110 Q260 95 280 70 L720 70 Q740 95 770 110 Z" fill="#241310" />
        <path d="M170 185 Q230 170 250 140 L750 140 Q770 170 830 185" fill="none" stroke="#c9a14a" strokeWidth="2.5" opacity="0.7" />
        <rect x="360" y="385" width="280" height="14" fill="#6d5644" />
        <rect x="380" y="372" width="240" height="14" fill="#7c6450" />
        {[200, 800].map((x, i) => (
          <g key={x}>
            <line x1={x} y1="178" x2={x} y2="210" stroke="#1c0f0d" strokeWidth="2" />
            <motion.circle
              cx={x}
              cy="232"
              r="46"
              fill="url(#lanternGlow)"
              animate={{ opacity: busy ? [0.55, 0.95, 0.55] : [0.35, 0.5, 0.35] }}
              transition={{ duration: busy ? 1.6 : 4, repeat: Infinity, delay: i * 0.4 }}
            />
            <ellipse cx={x} cy="232" rx="15" ry="21" fill="#d2452d" />
            <rect x={x - 9} y="208" width="18" height="5" fill="#2a1712" />
            <rect x={x - 9} y="251" width="18" height="5" fill="#2a1712" />
          </g>
        ))}
        {/* incense burner before the steps */}
        <g transform="translate(700 425) scale(0.7)">
          <path d="M-34 -18 L34 -18 L26 8 L-26 8 Z" fill="#6b5a2e" />
          <ellipse cx="0" cy="-18" rx="34" ry="7" fill="#8a7640" />
          {[-10, 0, 10].map((dx, i) => (
            <g key={dx}>
              <line x1={dx} y1="-20" x2={dx} y2="-48" stroke="#8b3a1e" strokeWidth="2" />
              <motion.path
                d={`M${dx} -50 q-8 -18 0 -36 q8 -18 0 -36`}
                fill="none"
                stroke="#e8dccb"
                strokeWidth="2"
                strokeLinecap="round"
                animate={{ opacity: busy ? [0, 0.6, 0] : [0, 0.25, 0], y: [0, -24] }}
                transition={{ duration: busy ? 2.4 : 5, repeat: Infinity, delay: i * 0.7 }}
              />
            </g>
          ))}
        </g>
      </g>
    </g>
  )
}
