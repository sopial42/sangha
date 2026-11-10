import { AnimatePresence, motion } from 'motion/react'
import type { SessionSummary } from '@sangha/shared'
import { robeOfAgent, STATUS_LABEL } from '../priests'

/** Half-axes of the closed pond's hit ellipse: both its click target and the seat→pond drop zone.
 *  Flat enough not to reach up over its pavilion's door, which stays clickable just above. */
export const POND_HIT_RX = 92
export const POND_HIT_RY = 40
/** Where the pond's own visual centers, relative to the anchor point passed in (the water lies on the
 *  anchor, the priests on its far bank rise a little above it) — also the hit-test center used for
 *  drop-zone detection, so it always matches what's actually drawn. */
export const POND_CENTER_Y = -4

const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/**
 * A priest at rest on the bank, an evening off: sitting cross-legged, leaning back a little, swaying
 * slowly; every other one holds a bowl of tea. A small silhouette — no face, no bubbles, he's at peace.
 */
function ChillingPriest({ robe, delay, tea, still }: { robe: string; delay: number; tea: boolean; still: boolean }) {
  return (
    <g className={still ? undefined : 'amb amb-chill-sway'} style={still ? undefined : { animationDelay: `${delay}s` }}>
      <ellipse cy="2" rx="15" ry="3.6" fill="#00000045" />
      {/* crossed legs, then the robe leaning back */}
      <path d="M-14 1 Q-13 -6 0 -6 Q13 -6 14 1 Z" fill={robe} opacity="0.85" />
      <path d="M-9 -4 L-8 -17 Q1 -25 9 -16 L10 -4 Z" fill={robe} />
      <circle cx="1.5" cy="-22" r="6" fill="#d9a577" />
      {tea && (
        <g transform="translate(6 -9)">
          <path d="M-3.5 0 L3.5 0 L2.5 3.5 L-2.5 3.5 Z" fill="#e8dccb" />
          <path
            d="M0 -2 Q-2 -6 0 -9 Q2 -12 0 -15"
            fill="none"
            stroke="#e8dccb"
            strokeOpacity="0.45"
            strokeWidth="1"
            className={still ? undefined : 'amb amb-tea-steam'}
            style={still ? undefined : { animationDelay: `${delay}s` }}
          />
        </g>
      )}
    </g>
  )
}

/** Where priests sit around the water, in the order they arrive: the far bank first, facing you,
 *  then its two ends, then the near bank. */
const BANK = [
  { x: 0, y: -21 },
  { x: -38, y: -18 },
  { x: 38, y: -18 },
  { x: -76, y: -2 },
  { x: 76, y: -2 },
  { x: -36, y: 25 },
  { x: 36, y: 25 },
]

/** A paper lantern floating on the water, its candle flickering. */
function FloatingLantern({ x, y, reducedMotion }: { x: number; y: number; reducedMotion: boolean }) {
  return (
    // The outer <g> carries the fixed position (a `transform` attribute): the CSS bob below lives on
    // a plain inner group instead, so it never fights that attribute.
    <g transform={`translate(${x} ${y})`}>
      <g className={reducedMotion ? undefined : 'amb amb-lantern-bob'}>
        <ellipse
          rx="16"
          ry="7"
          fill="url(#pondGlow)"
          opacity={reducedMotion ? 0.6 : undefined}
          className={reducedMotion ? undefined : 'amb amb-lantern-glow-pond'}
        />
        <path d="M-5 0 L-4 -8 L4 -8 L5 0 Z" fill="#f2c46d" opacity="0.92" />
        <rect x="-5.5" y="-1" width="11" height="2" rx="1" fill="#8a5a2b" />
      </g>
    </g>
  )
}

/** A lily pad: an irregular rounded leaf with a small notch, floating on the water. */
function LilyPad({ x, y, r, tone }: { x: number; y: number; r: number; tone: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse rx={r} ry={r * 0.42} fill="#0b2420" opacity="0.35" cy={r * 0.18} />
      <path
        d={`M0 ${-r * 0.42} A${r} ${r * 0.42} 0 1 1 ${-r * 0.06} ${r * 0.41} L0 0 Z`}
        fill={tone}
      />
    </g>
  )
}

/** Drifting mist over the water: a few soft pale blurs, barely there. Still on reduced motion. */
function Mist({ reducedMotion }: { reducedMotion: boolean }) {
  const puffs = [
    { x: -34, y: -4, r: 26, delay: 0 },
    { x: 18, y: -10, r: 30, delay: 1.1 },
    { x: 46, y: 0, r: 20, delay: 2.2 },
  ]
  return (
    <g opacity="0.5">
      {puffs.map((p, i) => (
        <ellipse
          key={i}
          cx={p.x}
          cy={p.y}
          rx={p.r}
          ry={p.r * 0.45}
          fill="url(#pondMist)"
          opacity={reducedMotion ? 0.22 : undefined}
          className={reducedMotion ? undefined : 'amb amb-mist'}
          style={reducedMotion ? undefined : { animationDelay: `${p.delay}s` }}
        />
      ))}
    </g>
  )
}

export function PondDefs() {
  return (
    <defs>
      <radialGradient id="pondWater" cx="0.4" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#2c5f55" />
        <stop offset="0.6" stopColor="#1c3e3a" />
        <stop offset="1" stopColor="#0f2622" />
      </radialGradient>
      <radialGradient id="pondMist">
        <stop offset="0" stopColor="#e8dccb" stopOpacity="0.7" />
        <stop offset="1" stopColor="#e8dccb" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pondGlow">
        <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
      </radialGradient>
    </defs>
  )
}

/**
 * A temple's lotus basin, closed, right at the foot of its pavilion: lily pads, a floating lantern, and its
 * priests set aside sitting around the water like an evening off — up to seven on the bank, a "+N"
 * for the rest. Calm — no labels, no bubbles: hovering one shows who he is and his note. Glows softly when one of them needs you, and again (a brighter ring) while a dragged
 * priest of this temple hovers, ready to be dropped in. Empty, it fades back, there for a drop.
 */
export function PondClosed({
  x,
  y,
  project,
  priests,
  resolveTitle,
  hiddenId,
  needsAttention,
  dropHover,
  reducedMotion,
  onOpen,
}: {
  x: number
  y: number
  project: string
  priests: SessionSummary[]
  resolveTitle: (p: SessionSummary) => string
  /** A priest mid-drag out of the pond: he's drawn as the drag ghost instead, not doubled here. */
  hiddenId: string | null
  needsAttention: boolean
  dropHover: boolean
  reducedMotion: boolean
  onOpen: () => void
}) {
  const visible = priests.filter((p) => p.id !== hiddenId)
  const shown = visible.slice(0, BANK.length)
  const extra = visible.length - shown.length
  const count = visible.length
  const label =
    count === 0
      ? `Bassin aux lotus de ${project} : vide pour l’instant. Glisse-y un de ses prêtres, ou ouvre-le pour voir`
      : `Bassin aux lotus de ${project} : ${count} prêtre${count > 1 ? 's' : ''} de côté${needsAttention ? ', dont un t’attend' : ''}. Ouvrir`
  return (
    // Placed by an outer group: the hover grow (CSS `transform: scale`) on the clickable one would
    // otherwise replace its translate, throwing the pond to the scene's origin, off the pointer, back…
    <g transform={`translate(${x} ${y})`} opacity={count === 0 && !dropHover ? 0.55 : 1}>
    <g
      className="lotus-pond clickable"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <title>{label}</title>
      {/* generous invisible tap target, well past the drawing itself */}
      <ellipse cy={POND_CENTER_Y} rx={POND_HIT_RX} ry={POND_HIT_RY} fill="transparent" />
      {needsAttention && <ellipse cy={POND_CENTER_Y} rx="96" ry="50" fill="url(#pondGlow)" className="amb amb-pond-attention" />}
      {dropHover && (
        <ellipse
          cy={POND_CENTER_Y}
          rx="90"
          ry="38"
          fill="none"
          stroke="#ffe9a8"
          strokeWidth="3"
          strokeDasharray="7 6"
          opacity={reducedMotion ? 0.9 : undefined}
          className={reducedMotion ? undefined : 'amb amb-pond-drop-ring'}
        />
      )}
      <Mist reducedMotion={reducedMotion} />
      {/* a stone rim of the same wood-brown as the pavilion's platform: the basin is part of the temple */}
      <ellipse cy="4" rx="73" ry="26" fill="#3d2f25" />
      <ellipse rx="69" ry="23.5" fill="#6d5644" />
      <ellipse cy="-1.5" rx="65" ry="21" fill="#2a2019" opacity="0.6" />
      <ellipse rx="62" ry="20" fill="url(#pondWater)" />
      <ellipse cy="-3" rx="46" ry="12" fill="none" stroke="#6fae8a" strokeOpacity="0.18" strokeWidth="1.5" />
      <LilyPad x={-34} y={6} r={14} tone="#3f7f6a" />
      <LilyPad x={22} y={9} r={16} tone="#4f8f6f" />
      <LilyPad x={44} y={-2} r={11} tone="#3a6f5c" />
      {/* a lotus flower among the pads, echoing Buddha's own throne */}
      <g transform="translate(-34 0)">
        {[0, 1, 2].map((i) => (
          <ellipse key={i} rx="4" ry="6.5" fill={i === 1 ? '#fbd7e0' : '#e79bb0'} transform={`rotate(${(i - 1) * 55})`} />
        ))}
      </g>
      <FloatingLantern x={2} y={2} reducedMotion={reducedMotion} />
      {shown
        .map((p, i) => ({ p, i, at: BANK[i]! }))
        .sort((a, b) => a.at.y - b.at.y)
        .map(({ p, i, at }) => (
          <g key={p.id} transform={`translate(${at.x} ${at.y})`}>
            <title>{`${resolveTitle(p)} : ${p.title}\n${p.note ?? 'Pas de note'}`}</title>
            <g transform="scale(1.2)">
              <ChillingPriest robe={robeOfAgent(p.agent)} delay={i * 0.7} tea={i % 2 === 1} still={reducedMotion} />
            </g>
            {/* A headless child never needs attention of his own: his parent answers to you. */}
            {!p.parent && ((p.status === 'waiting' && !p.silenced) || p.status === 'error') && (
              <circle cy="-42" r="4.5" fill="#ffb347" stroke="#2a2019" strokeWidth="1.5" />
            )}
          </g>
        ))}
      {extra > 0 && (
        <text x="92" y="-14" textAnchor="start" className="lotus-extra">
          +{extra}
        </text>
      )}
    </g>
    </g>
  )
}

/** One priest's line in the open pond: who he is, where, how he stands, and his note — a drag source too. */
function PondRow({
  p,
  projectAgents,
  y,
  w,
  onSelect,
  onRelease,
  onNote,
  onPointerDown,
  dragging,
}: {
  p: SessionSummary
  projectAgents: string
  y: number
  w: number
  onSelect: () => void
  onRelease: () => void
  onNote: () => void
  onPointerDown: (e: React.PointerEvent) => void
  dragging: boolean
}) {
  const robe = robeOfAgent(p.agent)
  const branch = p.branch ?? 'sans branche'
  const meta = `${projectAgents} · ⎇ ${branch} · ${STATUS_LABEL[p.status]}`
  // Room left of the two buttons (Note, Sortir), in characters of each line's font: a rough budget, no
  // DOM measurement for SVG text here.
  const chars = (px: number) => Math.max(12, Math.floor((w - 42 - 150) / px))
  const label = `${projectAgents} : ${p.title} (${STATUS_LABEL[p.status]}). Ouvrir sa conversation`
  return (
    // The row's own slide-in/out lives on this inner group: Framer Motion owns its transform once
    // `x` is animated, so the static vertical offset has to sit on a separate, outer `<g>` instead
    // of sharing the same element (the two would fight over the `transform` attribute).
    <g transform={`translate(0 ${y})`}>
      <motion.g initial={{ opacity: 0, x: -8 }} animate={{ opacity: dragging ? 0.3 : 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22 }}>
        <g
          className="lotus-row clickable"
          role="button"
          tabIndex={0}
          aria-label={label}
          onClick={onSelect}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
          onPointerDown={onPointerDown}
          style={{ touchAction: 'none' }}
        >
          <title>{label}</title>
          <rect x="10" y="3" width={w - 20} height={ROW_H - 8} rx="10" fill="#15101c66" />
          <circle cx="28" cy="20" r="6" fill={robe} />
          {/* His note first: it is how you tell your priests apart (« RIB ET MAIL », « BUG CAROLINE »…). */}
          <text x="42" y="24" className={p.note ? 'lotus-row-note' : 'lotus-row-note empty'}>
            {p.note ? truncate(p.note, chars(8.5)) : 'Sans note'}
          </text>
          <text x="42" y="42" className="lotus-row-name">
            {truncate(p.title, chars(7.5))}
          </text>
          <text x="42" y="58" className="lotus-row-meta">
            {truncate(meta, chars(6.2))}
          </text>
        </g>
        <g
          className="lotus-sortir clickable"
          role="button"
          tabIndex={0}
          aria-label={p.note ? `Modifier la note : ${p.note}` : 'Ajouter une note'}
          transform={`translate(${w - 146} ${ROW_H / 2 - 14})`}
          onClick={(e) => {
            e.stopPropagation()
            onNote()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onNote()
            }
          }}
        >
          <rect width="62" height="24" rx="12" fill="transparent" stroke="#e0b25a88" strokeWidth="1.3" />
          <text x="31" y="16" textAnchor="middle" className="lotus-sortir-text">
            ✎ Note
          </text>
        </g>
        <g
          className="lotus-sortir clickable"
          role="button"
          tabIndex={0}
          aria-label={`Sortir ${projectAgents} du bassin`}
          transform={`translate(${w - 78} ${ROW_H / 2 - 14})`}
          onClick={(e) => {
            e.stopPropagation()
            onRelease()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onRelease()
            }
          }}
        >
          <rect width="62" height="24" rx="12" fill="transparent" stroke="#e0b25a88" strokeWidth="1.3" />
          <text x="31" y="16" textAnchor="middle" className="lotus-sortir-text">
            Sortir
          </text>
        </g>
      </motion.g>
    </g>
  )
}

const ROW_H = 74
const HEADER_H = 40
const PANEL_PAD = 10

/** Size the open panel needs for `count` priests, capped to `maxW` wide. */
export function pondPanelSize(count: number, maxW: number) {
  const w = Math.max(320, Math.min(620, maxW))
  const h = HEADER_H + Math.max(1, count) * ROW_H + PANEL_PAD
  return { w, h }
}

/**
 * A temple's pond, opened: grown into a panel over the courtyard, each of its priests set aside in a row —
 * his name, branch, status and note — a « Sortir » button, or drag him back onto the courtyard.
 */
export function PondOpen({
  x,
  y,
  project,
  priests,
  resolveTitle,
  hiddenId,
  draggingId,
  width,
  onSelect,
  onRelease,
  onNote,
  onRowPointerDown,
}: {
  x: number
  y: number
  project: string
  priests: SessionSummary[]
  resolveTitle: (p: SessionSummary) => string
  hiddenId: string | null
  draggingId: string | null
  width: number
  onSelect: (id: string) => void
  onRelease: (id: string) => void
  onNote: (id: string) => void
  onRowPointerDown: (e: React.PointerEvent, id: string) => void
}) {
  const shown = priests.filter((p) => p.id !== hiddenId)
  const { w, h } = pondPanelSize(shown.length, width)
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      <rect width={w} height={h} rx="16" fill="#1d1725ee" stroke="#e0b25a55" strokeWidth="1.3" />
      <text x={w / 2} y="24" textAnchor="middle" className="lotus-panel-title">
        {`Bassin aux lotus · ${truncate(project, 28)}`}
      </text>
      <line x1="10" x2={w - 10} y1={HEADER_H - 6} y2={HEADER_H - 6} stroke="#3a2e40" />
      {shown.length === 0 && (
        <text x={w / 2} y={HEADER_H + ROW_H / 2 + 5} textAnchor="middle" className="lotus-row-meta">
          Personne n’est au repos ici pour l’instant.
        </text>
      )}
      <AnimatePresence>
        {shown.map((p, i) => (
          <PondRow
            key={p.id}
            p={p}
            projectAgents={resolveTitle(p)}
            y={HEADER_H + i * ROW_H}
            w={w}
            dragging={p.id === draggingId}
            onSelect={() => onSelect(p.id)}
            onRelease={() => onRelease(p.id)}
            onNote={() => onNote(p.id)}
            onPointerDown={(e) => onRowPointerDown(e, p.id)}
          />
        ))}
      </AnimatePresence>
    </g>
  )
}

/**
 * The dragged priest himself, following the pointer: a small silhouette, dimmed over an invalid drop.
 * `phase` 'dragging': tracks the pointer instantly. 'returning': eases back to where he started.
 * 'settling': eases to where he landed, then melts away — the server's own confirmation takes it from there.
 */
export function LotusDragGhost({
  x,
  y,
  robe,
  label,
  valid,
  phase,
}: {
  x: number
  y: number
  robe: string
  label: string
  valid: boolean
  phase: 'dragging' | 'settling' | 'returning'
}) {
  const live = phase === 'dragging'
  const settling = phase === 'settling'
  return (
    <motion.g
      animate={{ x, y }}
      transition={live ? { duration: 0 } : { duration: 0.38, ease: 'easeOut' }}
      style={{ pointerEvents: 'none' }}
    >
      <motion.g
        animate={{ opacity: settling ? 0 : valid ? 1 : 0.55, scale: settling ? 0.5 : valid ? 1.05 : 0.95 }}
        transition={{ duration: settling ? 0.38 : 0.15 }}
      >
        <ellipse cy="13" rx="30" ry="8" fill="#00000055" />
        <path d="M-22 0 L-20 -28 Q0 -46 20 -28 L22 0 Z" fill={robe} />
        <circle cy="-42" r="11" fill="#d9a577" />
        <text y="30" textAnchor="middle" className="lotus-row-name" fontSize="13">
          {label}
        </text>
      </motion.g>
    </motion.g>
  )
}
