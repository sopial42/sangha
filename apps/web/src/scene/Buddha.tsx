import { motion } from 'motion/react'

/** Buddha on his lotus. The halo breathes when idle and radiates while he thinks or speaks. */
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
        <radialGradient id="halo">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#f2b84b" stopOpacity="0.45" />
          <stop offset="1" stopColor="#f2b84b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8d77a" />
          <stop offset="0.6" stopColor="#d49a2a" />
          <stop offset="1" stopColor="#a8701a" />
        </linearGradient>
      </defs>

      <motion.circle
        cy="-120"
        r="110"
        fill="url(#halo)"
        animate={{ scale: busy ? [1, 1.12, 1] : [1, 1.03, 1], opacity: busy ? [0.8, 1, 0.8] : [0.55, 0.7, 0.55] }}
        transition={{ duration: busy ? 1.8 : 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      {speaking && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="0" y1="-205" x2="0" y2="-225" stroke="#ffe9a8" strokeWidth="3" strokeLinecap="round" opacity="0.6" transform={`rotate(${i * 30} 0 -120)`} />
          ))}
        </motion.g>
      )}

      {/* lotus */}
      {[-70, -42, -14, 14, 42, 70].map((x, i) => (
        <ellipse key={x} cx={x} cy="-6" rx="26" ry="14" fill={i % 2 ? '#e79bb0' : '#d97a95'} transform={`rotate(${x / 4} ${x} -6)`} />
      ))}
      {[-48, -16, 16, 48].map((x) => (
        <ellipse key={x} cx={x} cy="-16" rx="22" ry="12" fill="#f3b8c8" />
      ))}

      {/* body */}
      <path d="M-78 -20 Q-86 -60 -52 -92 Q-40 -150 0 -154 Q40 -150 52 -92 Q86 -60 78 -20 Z" fill="url(#gold)" />
      <path d="M-50 -30 Q0 -8 50 -30" fill="none" stroke="#a8701a" strokeWidth="3" />
      <path d="M-30 -140 Q-6 -100 28 -60" fill="none" stroke="#b9802a" strokeWidth="5" opacity="0.7" />
      {/* hands in dhyana mudra */}
      <ellipse cx="0" cy="-44" rx="26" ry="10" fill="#e9b94f" />
      {/* head */}
      <circle cy="-184" r="32" fill="url(#gold)" />
      <circle cy="-218" r="13" fill="#c98d24" />
      <ellipse cx="-33" cy="-176" rx="6" ry="16" fill="#d49a2a" />
      <ellipse cx="33" cy="-176" rx="6" ry="16" fill="#d49a2a" />
      {eyesOpen ? (
        [-9, 9].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="-184" rx="5" ry="3.6" fill="#fff8e1" />
            <circle cx={x} cy="-183.6" r="2.2" fill="#4a2c0a" />
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

      {selected && <ellipse cy="0" rx="96" ry="18" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
      <text y="30" textAnchor="middle" className="scene-name">
        Bouddha
      </text>
    </g>
  )
}
