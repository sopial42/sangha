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
        {/* lighter gold: his bare skin — face, neck, bare arm, hands, foot */}
        <linearGradient id="skinGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe4a3" />
          <stop offset="0.6" stopColor="#f3bd6e" />
          <stop offset="1" stopColor="#e0983f" />
        </linearGradient>
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
        cy="-141"
        r="44"
        fill="url(#haloInner)"
        animate={{ opacity: busy ? [0.7, 1, 0.7] : [0.45, 0.75, 0.45] }}
        transition={{ duration: busy ? 1.8 : 5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
      {speaking && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-170" x2="0" y2="-190" stroke="#ffe9a8" strokeWidth="3" strokeLinecap="round" opacity="0.6" transform={`rotate(${i * 30} 0 -141)`} />
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
        <path d="M-11 -115 Q-10 -104 0 -104 Q10 -104 11 -115 L9 -104 L-9 -104 Z" fill="url(#skinGold)" />
        <ellipse cy="-108" rx="10" ry="8" fill="url(#skinGold)" />
        <path d="M-7 -112 Q0 -110 7 -112 M-7 -108 Q0 -106 7 -108 M-7 -104 Q0 -102 7 -104" fill="none" stroke="#c9922f" strokeWidth="0.9" opacity="0.5" />

        {/* head: a slightly elongated oval, long earlobes, a conical ushnisha of curls, calm face */}
        <path d="M-20 -148 Q-31 -140 -29 -124 Q-27 -114 -20 -118 Q-23 -134 -17 -150 Z" fill="url(#skinGold)" />
        <path d="M20 -148 Q31 -140 29 -124 Q27 -114 20 -118 Q23 -134 17 -150 Z" fill="url(#skinGold)" />
        <ellipse cy="-141" rx="23" ry="26" fill="url(#skinGold)" />
        {/* the ushnisha: a distinct cone, not a dome, so the head doesn't read as a second ball */}
        <path d="M-12 -164 L-4 -184 Q0 -188 4 -184 L12 -164 Q6 -158 0 -157 Q-6 -158 -12 -164 Z" fill="url(#gold)" />
        {/* rows of small curls covering the crown, kept off the face */}
        {[
          [-12, -179], [-4, -181], [4, -181], [12, -179],
          [-17, -173], [-8, -176], [0, -177], [8, -176], [17, -173],
          [-20, -166], [-11, -170], [0, -171], [11, -170], [20, -166],
          [-21, -159], [21, -159],
          [-4, -191], [4, -191],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="#8a5e18" opacity="0.8" />
        ))}
        <path d="M-12 -155 q5 -3 9.5 -0.3 M2.5 -155 q5 -3 9.5 -0.3" fill="none" stroke="#7a4d10" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
        <circle cy="-160" r="2" fill="#fff3c4" />
        <path d="M-2 -147 L-3 -141 Q0 -139 3 -141 Z" fill="none" stroke="#7a4d10" strokeWidth="0.9" opacity="0.45" />
        {eyesOpen ? (
          // Idle: serene, half-closed eyes, downcast rather than wide open.
          [-7, 7].map((ex) => (
            <g key={ex}>
              <path d={`M${ex - 4} -149.6 Q${ex} -151.9 ${ex + 4} -149.6 Q${ex} -148.5 ${ex - 4} -149.6 Z`} fill="#3a2508" />
              <circle cx={ex} cy="-149.3" r="0.55" fill="#fff8e1" opacity="0.65" />
            </g>
          ))
        ) : (
          // Meditating: fully closed, calm eyes.
          <path d="M-11 -150 q5 3.3 10 0 M1 -150 q5 3.3 10 0" fill="none" stroke="#7a4d10" strokeWidth="1.8" strokeLinecap="round" />
        )}
        <motion.path
          d="M-5 -136 q5.5 3 11 0"
          fill="none"
          stroke="#7a4d10"
          strokeWidth="1.8"
          strokeLinecap="round"
          initial={false}
          animate={{ d: speaking ? ['M-5 -136 q5.5 3 11 0', 'M-5 -136 q5.5 6.3 11 0', 'M-5 -136 q5.5 3 11 0'] : 'M-5 -136 q5.5 3 11 0' }}
          transition={speaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
        />
      </motion.g>

      {selected && <ellipse cy="4" rx="90" ry="22" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="48" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
