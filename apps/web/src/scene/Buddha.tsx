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
        cy="-160"
        r="48"
        fill="url(#haloInner)"
        animate={{ opacity: busy ? [0.7, 1, 0.7] : [0.45, 0.75, 0.45] }}
        transition={{ duration: busy ? 1.8 : 5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
      {speaking && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-188" x2="0" y2="-208" stroke="#ffe9a8" strokeWidth="3" strokeLinecap="round" opacity="0.6" transform={`rotate(${i * 30} 0 -160)`} />
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
        {/* crossed legs: a broad seat, the robe's hem draped over them in nested folds */}
        <path
          d="M-90 -22 Q-98 -6 -84 6 Q-52 20 0 22 Q52 20 84 6 Q98 -6 90 -22 Q50 -28 0 -28 Q-50 -28 -90 -22 Z"
          fill="url(#lapShade)"
        />
        <path d="M-66 -18 Q0 -24 66 -18" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.55" strokeLinecap="round" />
        <path d="M-80 -9 Q0 -15 80 -9" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.55" strokeLinecap="round" />
        <path d="M-86 0 Q0 -6 86 0" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
        <path d="M-80 9 Q0 3 80 9" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
        <path d="M-58 17 Q0 11 58 17" fill="none" stroke="#7d4f10" strokeWidth="1.4" opacity="0.45" strokeLinecap="round" />
        {/* one bare foot resting on top of the crossed legs */}
        <ellipse cx="14" cy="-6" rx="15" ry="8" fill="url(#skinGold)" transform="rotate(-10 14 -6)" />
        <path d="M2 -6 Q8 -10 15 -9 M4 -2 Q10 -6 17 -5" fill="none" stroke="#c9922f" strokeWidth="1" opacity="0.5" strokeLinecap="round" />

        {/* torso: broad shoulders narrowing sharply to the waist */}
        <path
          d="M-58 -104 Q-72 -82 -64 -54 Q-56 -28 -32 -14 Q-14 -6 0 -6 Q14 -6 32 -14 Q56 -28 64 -54 Q72 -82 58 -104 Q30 -120 0 -122 Q-30 -120 -58 -104 Z"
          fill="url(#robeShade)"
        />
        {/* his right arm and shoulder bare: a distinct rounded limb, not just a silhouette trace */}
        <path d="M-56 -102 Q-74 -84 -68 -54 Q-62 -26 -42 -8 Q-30 0 -18 -2 Q-28 -24 -32 -52 Q-36 -80 -16 -98 Q-36 -110 -56 -102 Z" fill="url(#skinGold)" />
        {/* waist seam: marks where the sitting robe begins, under the torso */}
        <path d="M-50 -8 Q0 -1 50 -8" fill="none" stroke="#7d4f10" strokeWidth="1.6" opacity="0.4" strokeLinecap="round" />
        {/* fold lines: down the robed arm, and the sash crossing the chest from his left shoulder */}
        <path d="M26 -100 Q46 -66 36 -16" fill="none" stroke="#7d4f10" strokeWidth="1.8" opacity="0.6" strokeLinecap="round" />
        <path d="M38 -96 Q56 -62 46 -14" fill="none" stroke="#7d4f10" strokeWidth="1.8" opacity="0.6" strokeLinecap="round" />
        <path d="M50 -88 Q66 -56 54 -12" fill="none" stroke="#7d4f10" strokeWidth="1.8" opacity="0.55" strokeLinecap="round" />
        <path d="M16 -114 Q-6 -76 -28 -36" fill="none" stroke="#7d4f10" strokeWidth="2.2" opacity="0.55" strokeLinecap="round" />
        <path d="M28 -110 Q6 -72 -16 -32" fill="none" stroke="#7d4f10" strokeWidth="2.2" opacity="0.5" strokeLinecap="round" />
        <path d="M40 -102 Q18 -66 -4 -28" fill="none" stroke="#7d4f10" strokeWidth="2.2" opacity="0.45" strokeLinecap="round" />

        {/* hands joined in the dhyana mudra, fingers hinted, resting in his lap */}
        <ellipse cx="-2" cy="-4" rx="19" ry="9" fill="url(#skinGold)" />
        <ellipse cx="7" cy="-14" rx="16" ry="8.5" fill="url(#skinGold)" opacity="0.95" />
        <path d="M-8 -14 Q-2 -18 4 -14 M-1 -12 Q5 -16 11 -12 M5 -10 Q11 -14 17 -10" fill="none" stroke="#c9922f" strokeWidth="1" opacity="0.5" strokeLinecap="round" />
        <circle cx="15" cy="-15" r="1.8" fill="#c98d24" opacity="0.55" />

        {/* neck, narrower than the head, with the three auspicious folds */}
        <ellipse cy="-118" rx="12" ry="13" fill="url(#skinGold)" />
        <path d="M-9 -124 Q0 -121 9 -124 M-9 -119 Q0 -116 9 -119 M-8 -113 Q0 -110 8 -113" fill="none" stroke="#c9922f" strokeWidth="1" opacity="0.5" />

        {/* head: small cranium, long earlobes, a conical ushnisha of curls, calm face */}
        <path d="M-23 -166 Q-36 -156 -34 -138 Q-32 -128 -25 -132 Q-28 -150 -21 -168 Z" fill="url(#skinGold)" />
        <path d="M23 -166 Q36 -156 34 -138 Q32 -128 25 -132 Q28 -150 21 -168 Z" fill="url(#skinGold)" />
        <circle cy="-160" r="26" fill="url(#skinGold)" />
        <path d="M-11 -184 Q-12 -198 0 -204 Q12 -198 11 -184 Q6 -178 0 -177 Q-6 -178 -11 -184 Z" fill="url(#gold)" />
        {/* rows of small curls covering the crown, kept off the face */}
        {[
          [-13, -181], [-5, -183], [5, -183], [13, -181],
          [-18, -175], [-9, -178], [0, -179], [9, -178], [18, -175],
          [-21, -168], [-12, -172], [0, -173], [12, -172], [21, -168],
          [-23, -161], [23, -161],
          [-5, -196], [5, -196],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="#8a5e18" opacity="0.8" />
        ))}
        <path d="M-13 -166 q5 -3 10 -0.3 M3 -166 q5 -3 10 -0.3" fill="none" stroke="#7a4d10" strokeWidth="1.3" strokeLinecap="round" opacity="0.65" />
        <circle cy="-171" r="2.2" fill="#fff3c4" />
        <path d="M-2 -157 L-3 -151 Q0 -149 3 -151 Z" fill="none" stroke="#7a4d10" strokeWidth="1" opacity="0.45" />
        {eyesOpen ? (
          // Idle: serene, half-closed eyes, downcast rather than wide open.
          [-8, 8].map((ex) => (
            <g key={ex}>
              <path d={`M${ex - 4.5} -159.6 Q${ex} -162.2 ${ex + 4.5} -159.6 Q${ex} -158.3 ${ex - 4.5} -159.6 Z`} fill="#3a2508" />
              <circle cx={ex} cy="-159.3" r="0.6" fill="#fff8e1" opacity="0.65" />
            </g>
          ))
        ) : (
          // Meditating: fully closed, calm eyes.
          <path d="M-13 -160 q5.5 3.6 11 0 M2 -160 q5.5 3.6 11 0" fill="none" stroke="#7a4d10" strokeWidth="2" strokeLinecap="round" />
        )}
        <motion.path
          d="M-6 -146 q6 3.4 12 0"
          fill="none"
          stroke="#7a4d10"
          strokeWidth="2"
          strokeLinecap="round"
          initial={false}
          animate={{ d: speaking ? ['M-6 -146 q6 3.4 12 0', 'M-6 -146 q6 7 12 0', 'M-6 -146 q6 3.4 12 0'] : 'M-6 -146 q6 3.4 12 0' }}
          transition={speaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
        />
      </motion.g>

      {selected && <ellipse cy="8" rx="102" ry="24" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="54" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
