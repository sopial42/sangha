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

        {/* neck: short and clearly narrower than head and shoulders, with the three auspicious folds */}
        <path d="M-10 -118 Q-11 -110 -9 -104 L9 -104 Q11 -110 10 -118 Q0 -121 -10 -118 Z" fill="url(#skinGold)" />
        <path d="M-7 -114 Q0 -112 7 -114 M-7 -110 Q0 -108 7 -110 M-7 -106 Q0 -104.5 7 -106" fill="none" stroke="#c9922f" strokeWidth="0.9" opacity="0.5" />

        {/* head: a soft oval, wider at the cheeks, a rounded chin, no harsh outline */}
        <path
          d="M0 -176 Q21 -176 21 -155 Q24 -148 24 -140 Q24 -128 14 -124 Q7 -118 0 -118 Q-7 -118 -14 -124 Q-24 -128 -24 -140 Q-24 -148 -21 -155 Q-21 -176 0 -176 Z"
          fill="url(#faceSkin)"
        />
        <path
          d="M0 -176 Q21 -176 21 -155 Q24 -148 24 -140 Q24 -128 14 -124 Q7 -118 0 -118 Q-7 -118 -14 -124 Q-24 -128 -24 -140 Q-24 -148 -21 -155 Q-21 -176 0 -176 Z"
          fill="none"
          stroke="#a8701a"
          strokeWidth="0.8"
          opacity="0.3"
        />
        {/* long earlobes, close to the head, hanging to about chin level */}
        <path d="M-21 -153 Q-30 -146 -28 -130 Q-26 -118 -19 -121 Q-23 -136 -18 -153 Z" fill="url(#skinGold)" />
        <path d="M21 -153 Q30 -146 28 -130 Q26 -118 19 -121 Q23 -136 18 -153 Z" fill="url(#skinGold)" />
        <path d="M-23 -149 Q-27 -137 -22 -123 M23 -149 Q27 -137 22 -123" fill="none" stroke="#c9922f" strokeWidth="0.9" opacity="0.5" />

        {/* hair: the whole cranium above the hairline, neat rows of small snail-shell curls */}
        <path d="M-21 -155 Q0 -163 21 -155 Q21 -176 0 -176 Q-21 -176 -21 -155 Z" fill="url(#gold)" />
        {(
          [
            [-18, -162], [-12, -162], [-6, -162], [0, -162], [6, -162], [12, -162], [18, -162],
            [-15, -167], [-9, -167], [-3, -167], [3, -167], [9, -167], [15, -167],
            [-12, -171.5], [-6, -171.5], [0, -171.5], [6, -171.5], [12, -171.5],
            [-6, -175], [0, -175], [6, -175],
          ] as [number, number][]
        ).map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="1.7" fill="#8a5e18" opacity="0.88" />
            <circle cx={cx - 0.5} cy={cy - 0.5} r="0.55" fill="#f3c765" opacity="0.7" />
          </g>
        ))}
        {/* the ushnisha: a rounded mound of the same curls, tiered narrower, a smooth knob on top */}
        <ellipse cy="-179" rx="11" ry="6.5" fill="url(#gold)" />
        {[-6, 0, 6].map((cx) => (
          <g key={`t1-${cx}`}>
            <circle cx={cx} cy="-179" r="1.4" fill="#8a5e18" opacity="0.85" />
            <circle cx={cx - 0.4} cy="-179.4" r="0.45" fill="#f3c765" opacity="0.7" />
          </g>
        ))}
        <ellipse cy="-186" rx="7.5" ry="5" fill="url(#gold)" />
        {[-3.5, 3.5].map((cx) => (
          <g key={`t2-${cx}`}>
            <circle cx={cx} cy="-186" r="1.1" fill="#8a5e18" opacity="0.85" />
          </g>
        ))}
        <circle cy="-192" r="4" fill="url(#gold)" />
        <circle cx="-1.2" cy="-193.2" r="1.1" fill="#f8d77a" opacity="0.7" />

        {/* eyebrows: long smooth arches flowing down into the nose bridge, and the urna between them */}
        <path d="M-18 -149 Q-10 -153 -2 -149" fill="none" stroke="#7a4d10" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />
        <path d="M2 -149 Q10 -153 18 -149" fill="none" stroke="#7a4d10" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />
        <path d="M-2 -149 Q-3 -142 -2 -136 M2 -149 Q3 -142 2 -136" fill="none" stroke="#7a4d10" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
        <path d="M-4 -136 Q0 -132.5 4 -136" fill="none" stroke="#7a4d10" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
        <circle cy="-152" r="1.7" fill="#fff3c4" />
        {eyesOpen ? (
          // Idle: calm almond eyes, small dark pupils, under the same arched brows.
          [-9, 9].map((ex) => (
            <g key={ex}>
              <path d={`M${ex - 5} -144.4 Q${ex} -147.2 ${ex + 5} -144.4 Q${ex} -142.6 ${ex - 5} -144.4 Z`} fill="#fdf1cf" />
              <circle cx={ex} cy="-144.4" r="1.6" fill="#3a2508" />
              <circle cx={ex - 0.4} cy="-144.9" r="0.5" fill="#fff8e1" opacity="0.75" />
            </g>
          ))
        ) : (
          // Meditating: closed, downcast lids — an arc each, with a fine lower lash line.
          <>
            <path d="M-16 -144 Q-9 -147 -2 -144 M2 -144 Q9 -147 16 -144" fill="none" stroke="#7a4d10" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M-13 -142.5 Q-9 -141.3 -5 -142.5 M5 -142.5 Q9 -141.3 13 -142.5" fill="none" stroke="#7a4d10" strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
          </>
        )}
        {/* full lips, a faint serene smile; the upper line animates when he speaks */}
        <motion.path
          d="M-6 -128 Q0 -125.5 6 -128"
          fill="none"
          stroke="#7a4d10"
          strokeWidth="1.6"
          strokeLinecap="round"
          initial={false}
          animate={{ d: speaking ? ['M-6 -128 Q0 -125.5 6 -128', 'M-6 -128 Q0 -120 6 -128', 'M-6 -128 Q0 -125.5 6 -128'] : 'M-6 -128 Q0 -125.5 6 -128' }}
          transition={speaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
        />
        <path d="M-5 -124.5 Q0 -123 5 -124.5" fill="none" stroke="#7a4d10" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
      </motion.g>

      {selected && <ellipse cy="4" rx="90" ry="22" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="48" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
