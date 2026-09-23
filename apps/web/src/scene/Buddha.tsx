import { motion } from 'motion/react'

/** A seated Buddha on his lotus throne, legs crossed, hands joined in meditation. A tight golden
 *  nimbus glows behind his head, a wider aura around his whole seat; both breathe when idle and
 *  radiate while he thinks or speaks. He breathes gently at rest. */
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
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8d77a" />
          <stop offset="0.6" stopColor="#d49a2a" />
          <stop offset="1" stopColor="#a8701a" />
        </linearGradient>
        {/* robe volume in one smooth gradient (no separate shadow shapes): lit from the upper left */}
        <radialGradient id="robeShade" cx="0.35" cy="0.22" r="0.9">
          <stop offset="0" stopColor="#f8d77a" />
          <stop offset="0.55" stopColor="#d49a2a" />
          <stop offset="1" stopColor="#8f5c15" />
        </radialGradient>
        <radialGradient id="lapShade" cx="0.4" cy="0.15" r="0.95">
          <stop offset="0" stopColor="#e8bd6a" />
          <stop offset="0.6" stopColor="#c08a2a" />
          <stop offset="1" stopColor="#8a5c18" />
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
        cy="-184"
        r="50"
        fill="url(#haloInner)"
        animate={{ opacity: busy ? [0.7, 1, 0.7] : [0.45, 0.75, 0.45] }}
        transition={{ duration: busy ? 1.8 : 5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
      {speaking && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-205" x2="0" y2="-225" stroke="#ffe9a8" strokeWidth="3" strokeLinecap="round" opacity="0.6" transform={`rotate(${i * 30} 0 -184)`} />
          ))}
        </motion.g>
      )}

      {/* lotus throne: wider and a little lower, so it stays clearly visible under his lap */}
      {[-80, -56, -32, 0, 32, 56, 80].map((px, i) => (
        <ellipse key={px} cx={px} cy="6" rx="22" ry="13" fill={i % 2 ? 'url(#petalOuter)' : '#d97a95'} transform={`rotate(${px / 4} ${px} 6)`} />
      ))}
      {[-54, -27, 0, 27, 54].map((px) => (
        <ellipse key={px} cx={px} cy="-6" rx="20" ry="12" fill="url(#petalInner)" />
      ))}
      {[-18, 0, 18].map((px) => (
        <ellipse key={px} cx={px} cy="-14" rx="13" ry="9" fill="#fce4ea" opacity="0.9" />
      ))}
      {[-10, 0, 10].map((px) => (
        <circle key={px} cx={px} cy="-16" r="1.6" fill="#a8455f" opacity="0.55" />
      ))}

      {/* his seated figure breathes as one piece, at rest */}
      <motion.g animate={{ scaleY: [1, 1.016, 1] }} transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '50%', originY: '100%' }}>
        {/* crossed legs: a lap resting on the lotus, smaller than the flower so it stays visible all around */}
        <path
          d="M-80 -18 Q-84 -32 -62 -36 Q-34 -28 0 -26 Q34 -28 62 -36 Q84 -32 80 -18 Q50 -6 0 -4 Q-50 -6 -80 -18 Z"
          fill="url(#lapShade)"
        />
        {/* robe: one smooth silhouette, shaded for volume by a single gradient (no separate blob shapes) */}
        <path d="M-78 -20 Q-86 -60 -52 -92 Q-40 -150 0 -154 Q40 -150 52 -92 Q86 -60 78 -20 Z" fill="url(#robeShade)" />
        {/* his right shoulder and upper arm bare, following the robe's edge down from his neck */}
        <path d="M16 -148 Q38 -140 58 -96 Q48 -88 38 -96 Q24 -114 17 -136 Q14 -143 16 -148 Z" fill="#d9a577" />
        <path d="M16 -148 Q38 -140 58 -96" fill="none" stroke="#a8701a" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
        {/* fabric folds: the chest drape, and the robe's edge over his left shoulder */}
        <path d="M-46 -32 Q0 -16 46 -32" fill="none" stroke="#a8701a" strokeWidth="3" opacity="0.85" />
        <path d="M-30 -140 Q-6 -100 28 -60" fill="none" stroke="#b9802a" strokeWidth="5" opacity="0.65" />

        {/* hands joined in the dhyana mudra: two overlapping shapes, skin tone, resting in his lap */}
        <ellipse cx="-2" cy="-28" rx="18" ry="9" fill="#d9a577" />
        <ellipse cx="5" cy="-37" rx="15" ry="8" fill="#e2b488" />
        <path d="M-12 -37 Q4 -43 18 -37" fill="none" stroke="#b98a5e" strokeWidth="1.3" opacity="0.55" />
        <circle cx="13" cy="-39" r="1.8" fill="#c98d24" opacity="0.55" />

        {/* neck, narrower than the head, with the three auspicious folds */}
        <ellipse cy="-158" rx="13" ry="11" fill="#d9a577" />
        <path d="M-10 -163 Q0 -160 10 -163 M-10 -158 Q0 -155 10 -158 M-9 -153 Q0 -150 9 -153" fill="none" stroke="#b98a5e" strokeWidth="1" opacity="0.55" />

        {/* head: rounded cranium tapering into the ushnisha, long earlobes, curled hair, gentle brow */}
        <ellipse cx="-33" cy="-176" rx="6.5" ry="17" fill="#d49a2a" />
        <ellipse cx="33" cy="-176" rx="6.5" ry="17" fill="#d49a2a" />
        <circle cy="-184" r="32" fill="url(#gold)" />
        <path d="M-14 -207 Q-15 -225 0 -233 Q15 -225 14 -207 Q7 -199 0 -198 Q-7 -199 -14 -207 Z" fill="url(#gold)" />
        {/* small curls, kept off the face: crown, temples, and a couple on the ushnisha */}
        {[
          [-16, -206], [-6, -208], [6, -208], [16, -206],
          [-22, -198], [-11, -201], [0, -202], [11, -201], [22, -198],
          [-26, -188], [26, -188], [-24, -178], [24, -178],
          [-6, -216], [6, -216],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="#8a5e18" opacity="0.5" />
        ))}
        <path d="M-15 -192 q6 -3.5 11 -0.4 M4 -192 q6 -3.5 11 -0.4" fill="none" stroke="#7a4d10" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        {eyesOpen ? (
          // Idle: serene, half-closed eyes, downcast rather than wide open.
          [-9, 9].map((ex) => (
            <g key={ex}>
              <path d={`M${ex - 5} -183.6 Q${ex} -186.3 ${ex + 5} -183.6 Q${ex} -182.2 ${ex - 5} -183.6 Z`} fill="#3a2508" />
              <circle cx={ex} cy="-183.3" r="0.7" fill="#fff8e1" opacity="0.65" />
            </g>
          ))
        ) : (
          <path d="M-15 -184 q6 4 12 0 M3 -184 q6 4 12 0" fill="none" stroke="#7a4d10" strokeWidth="2.2" strokeLinecap="round" />
        )}
        <circle cy="-196" r="2.5" fill="#fff3c4" />
        <motion.path
          d="M-7 -170 q7 4 14 0"
          fill="none"
          stroke="#7a4d10"
          strokeWidth="2.2"
          strokeLinecap="round"
          initial={false}
          animate={{ d: speaking ? ['M-7 -170 q7 4 14 0', 'M-7 -170 q7 8 14 0', 'M-7 -170 q7 4 14 0'] : 'M-7 -170 q7 4 14 0' }}
          transition={speaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
        />
      </motion.g>

      {selected && <ellipse cy="0" rx="96" ry="18" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="30" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
