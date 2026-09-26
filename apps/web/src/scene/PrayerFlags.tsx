import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import type { WorktreeFlag } from '@sangha/shared'
import { formatAge, shortenPath, STATUS_LABEL } from '../priests'

/** Traditional lungta order (sky, cloud, fire, water, earth), cycling. */
const COLORS = ['#1f5fa8', '#f4efe2', '#b8322a', '#2f7d4a', '#e0b12a']
/** Om Mani Padme Hum, one syllable per flag, cycling independently of the colour above it. */
const MANTRA = [
  { glyph: 'ཨོཾ', translit: 'om' },
  { glyph: 'མ', translit: 'ma' },
  { glyph: 'ཎི', translit: 'ni' },
  { glyph: 'པད', translit: 'pad' },
  { glyph: 'མེ', translit: 'me' },
  { glyph: 'ཧཱུྃ', translit: 'hum' },
]
const FORTNIGHT = 14 * 24 * 60 * 60 * 1000
// Light backgrounds (the cloud and earth flags) need dark ink; the rest, the scene's usual cream.
const darkInk = (color: string) => color === COLORS[1] || color === COLORS[4]

/** A hanging rope's height at `x` (0 at its centre): a shallow parabola, close enough to a chainette at this scale. */
const sagAt = (x: number, half: number, sag: number) => sag * (1 - (x / half) ** 2)

/** One lungta: a small pennant strung from the rope, its syllable and colour set by its place in line. */
function Flag({
  x,
  topY,
  w,
  h,
  color,
  glyph,
  translit,
  showTranslit,
  flag,
  selected,
  onSelect,
}: {
  x: number
  /** Where the flag's own top edge hangs, just under the rope. */
  topY: number
  w: number
  h: number
  color: string
  glyph: string
  translit: string
  showTranslit: boolean
  flag: WorktreeFlag
  selected: boolean
  onSelect: (() => void) | null
}) {
  const [hot, setHot] = useState(false)
  const reducedMotion = useReducedMotion()
  const working = flag.session?.status === 'working'
  // Sun-bleached: no one has worked here in a fortnight, and no priest sits in it right now.
  const stale = !flag.session && (flag.lastCommit == null || Date.now() - flag.lastCommit > FORTNIGHT)
  const ink = darkInk(color) ? '#2a1d12' : '#f4efe2'

  const lines = [
    flag.branch ? `⎇ ${flag.branch}` : 'Sans branche',
    shortenPath(flag.path),
    flag.dirty > 0 ? `${flag.dirty} fichier${flag.dirty > 1 ? 's' : ''} modifié${flag.dirty > 1 ? 's' : ''}` : null,
    flag.ahead ? `${flag.ahead} commit${flag.ahead > 1 ? 's' : ''} d'avance` : null,
    flag.lastCommit ? `Dernier commit ${formatAge(flag.lastCommit)}` : null,
    flag.session ? `${flag.session.title} · ${STATUS_LABEL[flag.session.status]}` : null,
  ].filter((l): l is string => !!l)
  const label = `Étendard : ${lines.join(', ')}${onSelect ? '. Cliquer pour ouvrir sa session' : ''}`

  return (
    <g
      className="prayer-flag clickable"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected || undefined}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.()
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
          e.preventDefault()
          e.stopPropagation()
          onSelect()
        }
      }}
    >
      <title>{lines.join('\n')}</title>
      {/* Invisible, wider than the flag itself: a comfortable target at this small scale. */}
      <rect x={x - w} y={topY - 6} width={w * 2} height={h + 16} fill="transparent" />
      <line x1={x} y1={topY - 8} x2={x} y2={topY} stroke="#5a4322" strokeWidth="1" opacity="0.7" />
      <motion.g
        style={{ transformBox: 'fill-box', originX: '50%', originY: '0%' }}
        animate={working && !reducedMotion ? { rotate: [-3, 3, -3] } : { rotate: 0 }}
        transition={working && !reducedMotion ? { duration: 1.7, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.35 }}
        opacity={stale ? 0.4 : 1}
      >
        <path
          d={`M${x - w / 2} ${topY} H${x + w / 2} V${topY + h - 5} L${x + w / 4} ${topY + h} L${x} ${topY + h - 6} L${x - w / 4} ${topY + h} Z`}
          fill={color}
          stroke={hot || selected ? '#ffe9a8' : '#00000030'}
          strokeWidth={hot || selected ? 1.6 : 1}
        />
        <text x={x} y={topY + h * 0.44} textAnchor="middle" className="prayer-glyph" fill={ink}>
          {glyph}
        </text>
        {showTranslit && (
          <text x={x} y={topY + h * 0.44 + 9} textAnchor="middle" className="prayer-translit" fill={ink}>
            {translit}
          </text>
        )}
        {/* Uncommitted work: a small pastille, not loud enough to read as an error. */}
        {flag.dirty > 0 && <circle cx={x + w / 2 - 3} cy={topY + 4} r="2.6" fill="#ffcf5c" stroke="#00000055" strokeWidth="0.6" />}
      </motion.g>
      <AnimatePresence>{hot && <FlagTooltip x={x} bottom={topY - 10} lines={lines} />}</AnimatePresence>
    </g>
  )
}

/** A small parchment card above a flag on hover/focus, in the scene's own tooltip style. */
function FlagTooltip({ x, bottom, lines }: { x: number; bottom: number; lines: string[] }) {
  const lh = 13
  const pad = 7
  const w = Math.min(220, Math.max(...lines.map((l) => l.length)) * 5.6 + pad * 2)
  const h = lines.length * lh + pad * 2
  return (
    <motion.g initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <g transform={`translate(${x - w / 2} ${bottom - h})`}>
        <rect width={w} height={h} rx="8" fill="#1c0f0de6" stroke="#e0b25a88" />
        {lines.map((l, i) => (
          <text key={i} x={pad} y={pad + lh * (i + 1) - 3} className="prayer-tooltip-text">
            {l}
          </text>
        ))}
      </g>
    </motion.g>
  )
}

/**
 * Prayer flags strung above a monastery, one lungta per worktree: a rope in a shallow curve, sagging
 * between two anchor points just above the roof. Too many for one rope and a second one appears
 * below it; past that, the flags themselves shrink rather than spill outside the pavilion's width.
 */
export function PrayerFlags({
  worktrees,
  pavilionWidth,
  compact,
  selectedId,
  onSelect,
}: {
  worktrees: WorktreeFlag[]
  /** The pavilion's own body width (`PAVILION_W`): the rope spans a little past it on each side. */
  pavilionWidth: number
  /** A narrow mobile column: the latin transliteration is dropped so the glyph stays readable. */
  compact: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (worktrees.length === 0) return null

  const flagW = compact ? 16 : 20
  const flagH = compact ? 20 : 26
  const gap = compact ? 5 : 6
  const hang = compact ? 10 : 14
  const half = pavilionWidth / 2 + 26
  const usable = half * 2 - 14

  const maxPerRope = Math.max(1, Math.floor(usable / (flagW + gap)))
  const twoRopes = worktrees.length > maxPerRope
  const perRope = twoRopes ? Math.ceil(worktrees.length / 2) : worktrees.length
  // Even two ropes can't fit them at the base size: shrink the flags instead of overflowing the pavilion.
  const w = twoRopes && perRope > maxPerRope ? Math.max(9, usable / perRope - gap) : flagW
  const showTranslit = !compact && w >= 15

  const baseY = -150
  const ropeGap = flagH + hang + 20
  const sag = compact ? 6 : 9

  const indexed = worktrees.map((flag, i) => ({ flag, i }))
  const ropes = twoRopes ? [indexed.slice(0, perRope), indexed.slice(perRope)] : [indexed]

  return (
    <g>
      {ropes.map((rope, ri) => {
        const anchorY = baseY - ri * ropeGap
        const n = rope.length
        return (
          <g key={ri}>
            <path d={`M${-half} ${anchorY} Q0 ${anchorY + sag * 1.6} ${half} ${anchorY}`} fill="none" stroke="#5a4322" strokeWidth="1.3" opacity="0.75" />
            {rope.map(({ flag, i }) => {
              const cx = -usable / 2 + ((i - ri * perRope) + 0.5) * (usable / n)
              const ropeYAt = anchorY + sagAt(cx, half, sag)
              const mantra = MANTRA[i % MANTRA.length]!
              const color = COLORS[i % COLORS.length]!
              return (
                <Flag
                  key={flag.path}
                  x={cx}
                  topY={ropeYAt + hang}
                  w={w}
                  h={flagH}
                  color={color}
                  glyph={mantra.glyph}
                  translit={mantra.translit}
                  showTranslit={showTranslit}
                  flag={flag}
                  selected={!!flag.session && flag.session.id === selectedId}
                  onSelect={flag.session ? () => onSelect(flag.session!.id) : null}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
