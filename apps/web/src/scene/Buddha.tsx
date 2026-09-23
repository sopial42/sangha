import { motion } from 'motion/react'

/** A seated Buddha in lotus pose, his right shoulder bare, the robe draped from his left in many
 *  curved folds, hands joined in meditation. A tight golden nimbus glows behind his head, a wider
 *  aura around his whole seat; both breathe when idle and radiate while he thinks or speaks. He
 *  breathes gently at rest. */
export function Buddha({
  x,
  busy,
  speaking,
  eyesOpen,
  selected,
  onSelect,
}: {
  x: number
  busy: boolean
  speaking: boolean
  eyesOpen: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <g
      transform={`translate(${x} 360)`}
      className="buddha clickable"
      role="button"
      tabIndex={0}
      aria-label="Bouddha : lui parler"
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
    >
      <title>Parler à Bouddha</title>
      <defs>
        {/* wide aura around his whole seat: breathes, flares while he works or speaks */}
        <radialGradient id="halo">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#f2b84b" stopOpacity="0.45" />
          <stop offset="1" stopColor="#f2b84b" stopOpacity="0" />
        </radialGradient>
        {/* tight nimbus close behind his head, brighter at the core: a gradient stands in for a blur */}
        <radialGradient id="haloInner">
          <stop offset="0" stopColor="#fff6db" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#ffe9a8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
        {/* richer gold: his hair and ushnisha */}
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8d77a" />
          <stop offset="0.6" stopColor="#d49a2a" />
          <stop offset="1" stopColor="#a8701a" />
        </linearGradient>
        {/* the robe: a deeper, more saturated gold than his skin, for contrast */}
        <radialGradient id="robeShade" cx="0.35" cy="0.16" r="0.95">
          <stop offset="0" stopColor="#f3c765" />
          <stop offset="0.55" stopColor="#c4841c" />
          <stop offset="1" stopColor="#7d4f10" />
        </radialGradient>
        <radialGradient id="lapShade" cx="0.4" cy="0.08" r="1">
          <stop offset="0" stopColor="#e3b45e" />
          <stop offset="0.6" stopColor="#b87f22" />
          <stop offset="1" stopColor="#7d5013" />
        </radialGradient>
        {/* lighter gold: his bare skin — bare arm, hands, foot, neck, ears */}
        <linearGradient id="skinGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe4a3" />
          <stop offset="0.6" stopColor="#f3bd6e" />
          <stop offset="1" stopColor="#e0983f" />
        </linearGradient>
        {/* his face: lighter at the centre, warming toward the edges — a gradient stands in for a soft shade */}
        <radialGradient id="faceSkin" cx="0.42" cy="0.36" r="0.8">
          <stop offset="0" stopColor="#ffedc0" />
          <stop offset="0.6" stopColor="#f3bd6e" />
          <stop offset="1" stopColor="#dd9640" />
        </radialGradient>
        <linearGradient id="petalOuter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3b8c8" />
          <stop offset="1" stopColor="#d97a95" />
        </linearGradient>
        <linearGradient id="petalInner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbd7e0" />
          <stop offset="1" stopColor="#e79bb0" />
        </linearGradient>
      </defs>

      <motion.circle
        cy="-120"
        r="110"
        fill="url(#halo)"
        animate={{ scale: busy ? [1, 1.12, 1] : [1, 1.03, 1], opacity: busy ? [0.8, 1, 0.8] : [0.55, 0.7, 0.55] }}
        transition={{ duration: busy ? 1.8 : 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.circle
        cy="-147"
        r="42"
        fill="url(#haloInner)"
        animate={{ opacity: busy ? [0.7, 1, 0.7] : [0.45, 0.75, 0.45] }}
        transition={{ duration: busy ? 1.8 : 5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
      {speaking && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-178" x2="0" y2="-197" stroke="#ffe9a8" strokeWidth="3" strokeLinecap="round" opacity="0.6" transform={`rotate(${i * 30} 0 -147)`} />
          ))}
        </motion.g>
      )}

      {/* lotus throne: below his crossed legs, wide enough to stay visible all around them */}
      {[-84, -58, -32, 0, 32, 58, 84].map((px, i) => (
        <ellipse key={px} cx={px} cy="28" rx="22" ry="13" fill={i % 2 ? 'url(#petalOuter)' : '#d97a95'} transform={`rotate(${px / 4} ${px} 28)`} />
      ))}
      {[-56, -28, 0, 28, 56].map((px) => (
        <ellipse key={px} cx={px} cy="17" rx="20" ry="12" fill="url(#petalInner)" />
      ))}
      {[-18, 0, 18].map((px) => (
        <ellipse key={px} cx={px} cy="10" rx="13" ry="9" fill="#fce4ea" opacity="0.9" />
      ))}
      {[-10, 0, 10].map((px) => (
        <circle key={px} cx={px} cy="8" r="1.6" fill="#a8455f" opacity="0.55" />
      ))}

      {/* his seated figure breathes as one piece, at rest */}
      <motion.g animate={{ scaleY: [1, 1.014, 1] }} transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '50%', originY: '100%' }}>
        {/* crossed legs: a wide flat seat, the robe's hem draped over them in nested folds */}
        <path
          d="M-72 -22 Q-80 -6 -66 6 Q-40 16 0 17 Q40 16 66 6 Q80 -6 72 -22 Q40 -26 0 -26 Q-40 -26 -72 -22 Z"
          fill="url(#lapShade)"
        />
        <path d="M-52 -19 Q0 -24 52 -19" fill="none" stroke="#7d4f10" strokeWidth="1.5" opacity="0.5" strokeLinecap="round" />
        <path d="M-64 -10 Q0 -16 64 -10" fill="none" stroke="#7d4f10" strokeWidth="1.5" opacity="0.5" strokeLinecap="round" />
        <path d="M-70 -1 Q0 -7 70 -1" fill="none" stroke="#7d4f10" strokeWidth="1.5" opacity="0.48" strokeLinecap="round" />
        <path d="M-62 7 Q0 2 62 7" fill="none" stroke="#7d4f10" strokeWidth="1.4" opacity="0.42" strokeLinecap="round" />
        {/* one bare foot resting on top of the crossed legs */}
        <ellipse cx="12" cy="-6" rx="13" ry="7" fill="url(#skinGold)" transform="rotate(-10 12 -6)" />
        <path d="M2 -6 Q7 -9 13 -8 M4 -3 Q9 -6 15 -5" fill="none" stroke="#c9922f" strokeWidth="1" opacity="0.5" strokeLinecap="round" />

        {/* torso: a trapezoid — flat, rounded shoulders narrowing on straight sides to the waist */}
        <path
          d="M-45 -96 Q-40 -104 -30 -104 L30 -104 Q40 -104 45 -96 L33 -26 Q30 -20 20 -18 L-20 -18 Q-30 -20 -33 -26 Z"
          fill="url(#robeShade)"
        />
        {/* a sliver of bare skin at the collarbone, above where the diagonal robe begins */}
        <path d="M-38 -98 Q-30 -103 -21 -100 Q-17 -90 -23 -78 Q-33 -85 -38 -98 Z" fill="url(#skinGold)" />

        {/* his right arm bare: a separate limb along the torso's outer side, a thin gap from the chest */}
        <path
          d="M-42 -96 Q-58 -80 -55 -52 Q-52 -28 -34 -12 Q-22 -3 -10 -6 Q-22 -16 -27 -32 Q-32 -52 -27 -74 Q-35 -86 -42 -96 Z"
          fill="url(#skinGold)"
        />
        <path d="M-36 -92 Q-28 -58 -25 -28" fill="none" stroke="#c9922f" strokeWidth="1.1" opacity="0.4" strokeLinecap="round" />
        {/* his left arm robed, folds running down its length */}
        <path
          d="M42 -96 Q58 -80 55 -52 Q52 -28 34 -12 Q22 -3 10 -6 Q22 -16 27 -32 Q32 -52 27 -74 Q35 -86 42 -96 Z"
          fill="url(#robeShade)"
        />
        <path d="M-4 -12 Q10 -30 12 -60 Q13 -80 4 -94" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.55" strokeLinecap="round" />
        <path d="M4 -10 Q19 -28 22 -58 Q23 -78 15 -92" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
        <path d="M14 -10 Q28 -26 32 -54 Q34 -74 27 -88" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.45" strokeLinecap="round" />
        {/* the sash: diagonal folds crossing the chest from his left shoulder to his right waist */}
        <path d="M25 -99 Q4 -70 -18 -30" fill="none" stroke="#7d4f10" strokeWidth="2" opacity="0.55" strokeLinecap="round" />
        <path d="M33 -94 Q13 -66 -9 -26" fill="none" stroke="#7d4f10" strokeWidth="2" opacity="0.5" strokeLinecap="round" />
        <path d="M40 -86 Q22 -60 1 -22" fill="none" stroke="#7d4f10" strokeWidth="2" opacity="0.45" strokeLinecap="round" />

        {/* hands joined in the dhyana mudra, fingers hinted, resting at the center of his lap */}
        <ellipse cx="-2" cy="-8" rx="17" ry="8.5" fill="url(#skinGold)" />
        <ellipse cx="6" cy="-17" rx="14" ry="7.5" fill="url(#skinGold)" opacity="0.95" />
        <path d="M-7 -17 Q-1 -20 4 -17 M0 -15 Q5 -19 10 -15 M4 -13 Q9 -16 14 -13" fill="none" stroke="#c9922f" strokeWidth="1" opacity="0.5" strokeLinecap="round" />
        <circle cx="12" cy="-18" r="1.6" fill="#c98d24" opacity="0.55" />

        {/* neck: short, a touch narrower at the jaw, two soft folds */}
        <path d="M-9.5 -118 Q-10 -109 -12 -104 L12 -104 Q10 -109 9.5 -118 Z" fill="url(#skinGold)" />
        <path d="M-7 -110 Q0 -108.6 7 -110 M-8 -106.5 Q0 -105 8 -106.5" fill="none" stroke="#c9922f" strokeWidth="0.8" opacity="0.45" />

        {/* long ears behind the head, lobes hanging to the jaw */}
        <path d="M-17 -148 C-25 -150 -27 -139 -25 -131 C-24 -125 -24 -119 -19.5 -118 C-16 -118.5 -15 -122 -14 -126 Z" fill="url(#skinGold)" />
        <path d="M17 -148 C25 -150 27 -139 25 -131 C24 -125 24 -119 19.5 -118 C16 -118.5 15 -122 14 -126 Z" fill="url(#skinGold)" />
        <path d="M-21.5 -144 Q-23.5 -137 -21 -129 M21.5 -144 Q23.5 -137 21 -129" fill="none" stroke="#c9922f" strokeWidth="0.9" opacity="0.5" strokeLinecap="round" />

        {/* head: an egg-shaped oval, full cheeks, a soft rounded chin */}
        <path d="M0 -168 C13 -168 20 -159 20 -147 C20 -131 13 -115 0 -113 C-13 -115 -20 -131 -20 -147 C-20 -159 -13 -168 0 -168 Z" fill="url(#faceSkin)" />

        {/* hair: a cap of snail-shell curls above a gentle arched hairline */}
        <path d="M-20 -147 C-20 -159 -13 -168 0 -168 C13 -168 20 -159 20 -147 Q0 -159 -20 -147 Z" fill="url(#gold)" />
        {(
          [
            [-16, -154], [-11, -156], [-5.5, -157], [0, -157.3], [5.5, -157], [11, -156], [16, -154],
            [-13.5, -160.5], [-8, -161.8], [-2.7, -162.3], [2.7, -162.3], [8, -161.8], [13.5, -160.5],
            [-9, -165.8], [-3, -166.6], [3, -166.6], [9, -165.8],
          ] as [number, number][]
        ).map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="2" fill="#8a5e18" opacity="0.7" />
            <circle cx={cx - 0.6} cy={cy - 0.6} r="0.7" fill="#f3c765" opacity="0.75" />
          </g>
        ))}
        {/* the ushnisha: a low dome of the same curls, a small round knob on top */}
        <path d="M-12 -165 Q-12 -181 0 -181 Q12 -181 12 -165 Z" fill="url(#gold)" />
        {(
          [
            [-8, -168.5], [-4, -169.2], [0, -169.4], [4, -169.2], [8, -168.5],
            [-6, -173.3], [-2, -174], [2, -174], [6, -173.3],
            [-2.5, -177.4], [2.5, -177.4],
          ] as [number, number][]
        ).map(([cx, cy]) => (
          <g key={`u${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="1.7" fill="#8a5e18" opacity="0.7" />
            <circle cx={cx - 0.5} cy={cy - 0.5} r="0.6" fill="#f3c765" opacity="0.75" />
          </g>
        ))}
        <circle cy="-182.5" r="2.8" fill="url(#gold)" />
        <circle cx="-0.9" cy="-183.4" r="0.9" fill="#f8d77a" opacity="0.75" />

        {/* brows: long arches, the left one flowing down into the nose; the urna between them */}
        <path d="M-15 -142.5 Q-9 -146.5 -2.5 -143 Q-1.5 -136 -2.5 -131" fill="none" stroke="#7a4d10" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        <path d="M15 -142.5 Q9 -146.5 2.5 -143" fill="none" stroke="#7a4d10" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <path d="M-4 -130.3 Q-2 -128.6 0 -129.3 Q2 -128.6 4 -130.3" fill="none" stroke="#7a4d10" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
        <circle cy="-148" r="1.3" fill="#fff3c4" />
        {eyesOpen ? (
          // Waiting for you: calm, half-open eyes under heavy lids.
          [-8.5, 8.5].map((ex) => (
            <g key={ex}>
              <path d={`M${ex - 4.5} -139.5 Q${ex} -141.4 ${ex + 4.5} -139.5 Q${ex} -138 ${ex - 4.5} -139.5 Z`} fill="#fdf1cf" />
              <circle cx={ex} cy="-139.4" r="1.3" fill="#3a2508" />
              <path d={`M${ex - 4.8} -139.4 Q${ex} -141.9 ${ex + 4.8} -139.4`} fill="none" stroke="#7a4d10" strokeWidth="1.3" strokeLinecap="round" />
            </g>
          ))
        ) : (
          // Meditating: downcast closed lids, a faint crease above each.
          <>
            <path d="M-13 -139.5 Q-8.5 -137.2 -4 -139.5 M4 -139.5 Q8.5 -137.2 13 -139.5" fill="none" stroke="#7a4d10" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M-12.5 -141.3 Q-8.5 -142.6 -4.5 -141.3 M4.5 -141.3 Q8.5 -142.6 12.5 -141.3" fill="none" stroke="#7a4d10" strokeWidth="0.7" strokeLinecap="round" opacity="0.35" />
          </>
        )}
        {/* small full lips, a faint serene smile; the line opens when he speaks */}
        <motion.path
          d="M-5 -121.5 Q0 -119.6 5 -121.5"
          fill="none"
          stroke="#7a4d10"
          strokeWidth="1.2"
          opacity="0.85"
          strokeLinecap="round"
          initial={false}
          animate={{ d: speaking ? ['M-5 -121.5 Q0 -119.6 5 -121.5', 'M-5 -121.5 Q0 -115.5 5 -121.5', 'M-5 -121.5 Q0 -119.6 5 -121.5'] : 'M-5 -121.5 Q0 -119.6 5 -121.5' }}
          transition={speaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
        />
        <path d="M-3.5 -118.4 Q0 -117.2 3.5 -118.4" fill="none" stroke="#7a4d10" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      </motion.g>

      {selected && <ellipse cy="4" rx="90" ry="22" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="48" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
