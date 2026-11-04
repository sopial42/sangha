import { AnimatePresence, motion } from 'motion/react'
import type { SessionSummary } from '@sangha/shared'
import { robeOfAgent, STATUS_LABEL } from '../priests'

/** Hit radius of the closed pond (world units): both its click target and the seat→pond drop zone. */
export const POND_HIT_R = 92
/** Where the pond's own visual centers, relative to the anchor point passed in (the water sits a
 *  little below the anchor, the tree rises above it) — also the hit-test center used for drop-zone
 *  detection, so it always matches what's actually drawn. */
export const POND_CENTER_Y = -18

const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/** A priest at rest, simplified to a small silhouette: no face, no bubbles — he's set aside, at peace. */
function MiniPriest({ robe, bob }: { robe: string; bob: number }) {
  return (
    <motion.g animate={{ y: [0, -2.5, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: bob }}>
      <ellipse cy="3" rx="13" ry="3.4" fill="#00000040" />
      <path d="M-11 0 L-10 -13 Q0 -22 10 -13 L11 0 Z" fill={robe} />
      <circle cy="-18" r="5.6" fill="#d9a577" />
    </motion.g>
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
        <motion.ellipse
          key={i}
          cx={p.x}
          cy={p.y}
          rx={p.r}
          ry={p.r * 0.45}
          fill="url(#pondMist)"
          animate={reducedMotion ? { opacity: 0.22 } : { opacity: [0.1, 0.3, 0.1], x: [p.x - 6, p.x + 6, p.x - 6] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
        />
      ))}
    </g>
  )
}

/** A slender Bodhi tree over the pond: a dark trunk, a canopy of soft rounded, heart-leaning leaves. */
function BodhiTree() {
  const leaves = [
    { x: -18, y: -118, r: 30 },
    { x: 14, y: -128, r: 34 },
    { x: 36, y: -102, r: 24 },
    { x: -2, y: -96, r: 26 },
    { x: -32, y: -92, r: 20 },
  ]
  return (
    <g>
      <path d="M-4 0 Q-10 -40 -2 -78 Q2 -92 10 -100" fill="none" stroke="#3a2a1c" strokeWidth="7" strokeLinecap="round" />
      <path d="M-2 -30 Q-16 -42 -22 -58" fill="none" stroke="#3a2a1c" strokeWidth="4" strokeLinecap="round" />
      {leaves.map((l, i) => (
        <ellipse key={i} cx={l.x} cy={l.y} rx={l.r} ry={l.r * 0.82} fill={i % 2 ? '#3e5631' : '#4d6b3f'} opacity="0.92" />
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
 * The lotus pond, closed: a cluster of lily pads under a Bodhi tree, up to three priests set aside
 * visible, a "+N" for the rest. Calm — no labels, no bubbles. Glows softly when one of them needs you,
 * and again (a brighter ring) while a dragged priest hovers, ready to be dropped in.
 */
export function PondClosed({
  x,
  y,
  priests,
  hiddenId,
  needsAttention,
  dropHover,
  reducedMotion,
  onOpen,
}: {
  x: number
  y: number
  priests: SessionSummary[]
  /** A priest mid-drag out of the pond: he's drawn as the drag ghost instead, not doubled here. */
  hiddenId: string | null
  needsAttention: boolean
  dropHover: boolean
  reducedMotion: boolean
  onOpen: () => void
}) {
  const visible = priests.filter((p) => p.id !== hiddenId)
  const shown = visible.slice(-3)
  const extra = visible.length - shown.length
  const count = visible.length
  const label =
    count === 0
      ? 'Bassin aux lotus : vide pour l’instant. Glisse-y un prêtre, ou ouvre-le pour voir'
      : `Bassin aux lotus : ${count} prêtre${count > 1 ? 's' : ''} de côté${needsAttention ? ', dont un t’attend' : ''}. Ouvrir`
  return (
    <g
      transform={`translate(${x} ${y})`}
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
      <circle cy={POND_CENTER_Y} r={POND_HIT_R} fill="transparent" />
      {needsAttention && (
        <motion.ellipse
          cy={POND_CENTER_Y - 10}
          rx="78"
          ry="66"
          fill="url(#pondGlow)"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      )}
      {dropHover && (
        <motion.ellipse
          cy={POND_CENTER_Y}
          rx="86"
          ry="40"
          fill="none"
          stroke="#ffe9a8"
          strokeWidth="3"
          strokeDasharray="7 6"
          animate={reducedMotion ? { opacity: 0.9 } : { scale: [1, 1.07, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      )}
      <BodhiTree />
      <Mist reducedMotion={reducedMotion} />
      <ellipse cy="8" rx="80" ry="30" fill="url(#pondWater)" />
      <ellipse cy="2" rx="60" ry="18" fill="none" stroke="#6fae8a" strokeOpacity="0.18" strokeWidth="1.5" />
      <LilyPad x={-46} y={14} r={22} tone="#3f7f6a" />
      <LilyPad x={-6} y={20} r={26} tone="#4f8f6f" />
      <LilyPad x={38} y={12} r={20} tone="#3a6f5c" />
      {/* a lotus flower or two among the pads, echoing Buddha's own throne */}
      <g transform="translate(-46 5)">
        {[0, 1, 2].map((i) => (
          <ellipse key={i} rx="6" ry="9" fill={i === 1 ? '#fbd7e0' : '#e79bb0'} transform={`rotate(${(i - 1) * 55})`} />
        ))}
      </g>
      {shown.map((p, i) => (
        <g key={p.id} transform={`translate(${(i - (shown.length - 1) / 2) * 24} ${2 - i * 3})`}>
          <MiniPriest robe={robeOfAgent(p.agent)} bob={i * 0.6} />
        </g>
      ))}
      {extra > 0 && (
        <text x={(shown.length / 2) * 24 + 16} y="-8" textAnchor="start" className="lotus-extra">
          +{extra}
        </text>
      )}
      {needsAttention && <circle cx="66" cy={POND_CENTER_Y - 48} r="6" fill="#ffb347" stroke="#2a2019" strokeWidth="1.5" />}
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
  onPointerDown,
  dragging,
}: {
  p: SessionSummary
  projectAgents: string
  y: number
  w: number
  onSelect: () => void
  onRelease: () => void
  onPointerDown: (e: React.PointerEvent) => void
  dragging: boolean
}) {
  const robe = robeOfAgent(p.agent)
  const branch = p.branch ?? 'sans branche'
  const meta = `⎇ ${truncate(branch, 26)} · ${STATUS_LABEL[p.status]}${p.note ? ` · ${truncate(p.note, 30)}` : ''}`
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
          <rect x="10" y="3" width={w - 20} height="50" rx="10" fill="#15101c66" />
          <circle cx="28" cy="28" r="6" fill={robe} />
          <text x="42" y="22" className="lotus-row-name">
            {truncate(projectAgents, 30)}
          </text>
          <text x="42" y="40" className="lotus-row-meta">
            {truncate(meta, 46)}
          </text>
        </g>
        <g
          className="lotus-sortir clickable"
          role="button"
          tabIndex={0}
          aria-label={`Sortir ${projectAgents} du bassin`}
          transform={`translate(${w - 78} 16)`}
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

const ROW_H = 58
const HEADER_H = 40
const PANEL_PAD = 10

/** Size the open panel needs for `count` priests, capped to `maxW` wide. */
export function pondPanelSize(count: number, maxW: number) {
  const w = Math.max(280, Math.min(560, maxW))
  const h = HEADER_H + Math.max(1, count) * ROW_H + PANEL_PAD
  return { w, h }
}

/**
 * The pond, opened: grown into a panel over the courtyard, every priest set aside listed in a row —
 * his name, branch, status and note — a « Sortir » button, or drag him back onto the courtyard.
 */
export function PondOpen({
  x,
  y,
  priests,
  resolveTitle,
  hiddenId,
  draggingId,
  width,
  onSelect,
  onRelease,
  onRowPointerDown,
}: {
  x: number
  y: number
  priests: SessionSummary[]
  resolveTitle: (p: SessionSummary) => string
  hiddenId: string | null
  draggingId: string | null
  width: number
  onSelect: (id: string) => void
  onRelease: (id: string) => void
  onRowPointerDown: (e: React.PointerEvent, id: string) => void
}) {
  const shown = priests.filter((p) => p.id !== hiddenId)
  const { w, h } = pondPanelSize(shown.length, width)
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      <rect width={w} height={h} rx="16" fill="#1d1725ee" stroke="#e0b25a55" strokeWidth="1.3" />
      <text x={w / 2} y="24" textAnchor="middle" className="lotus-panel-title">
        Bassin aux lotus
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
