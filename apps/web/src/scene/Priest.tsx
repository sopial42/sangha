import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { MonkProfile, NoviceSummary, SessionSummary } from '@sangha/shared'
import { CONTEXT_COLOR, contextLevel, formatCost, formatTokens } from '../priests'
import { profileFor, toolIcon } from '../profiles'
import { Incense } from './Incense'


/** Eyes closed while he meditates on work, open whenever he is doing nothing; heavy-lidded when tired. */
function Eyes({ y, open, tired }: { y: number; open: boolean; tired: number }) {
  return open ? (
    <g>
      {[-5, 5].map((x) => {
        // Tired, one eye closes more and more, never fully (three quarters at most); the other only grows heavy.
        const lid = x > 0 ? 3.9 * tired : 1.4 * tired
        return (
          <g key={x}>
            <ellipse cx={x} cy={y} rx="3.2" ry="2.6" fill="#fdf6e3" />
            <circle cx={x} cy={y + 0.3 + tired * 0.6} r="1.6" fill="#2a1d12" />
            {lid > 0.2 && <path d={`M${x - 3.6} ${y - 2.8} h7.2 v${lid} h-7.2 Z`} fill="#d9a577" />}
          </g>
        )
      })}
    </g>
  ) : (
    <path d={`M-8 ${y} q3 2.4 6 0 M2 ${y} q3 2.4 6 0`} fill="none" stroke="#5a3a22" strokeWidth="1.8" strokeLinecap="round" />
  )
}

/** Word-wrap a whole text into lines of about `width` characters (a single long word stays whole). */
function wrapAll(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

/**
 * A parchment callout beside a priest's head, a small tail pointing at him. Anchored to one side
 * (away from his pavilion behind him) so it never covers his incense or the pavilion itself.
 * Plain SVG text (Safari-safe), a flat offset silhouette stands in for a drop shadow (no blur:
 * Safari does not blur SVG). `near` narrows on a mobile column, so the callout stays clear of the
 * courtyard's edges instead of running off screen.
 */
function Callout({ w, h, side, near = 56, children }: { w: number; h: number; side: 1 | -1; near?: number; children: ReactNode }) {
  const bottom = -92 // just above his head, clear of his feet and his incense below
  const top = bottom - h
  const left = side === 1 ? near : -near - w
  const innerX = side * near
  const tipX = side * 18
  const tail = `M${innerX} ${bottom - 4} L${tipX} -80 L${innerX} ${bottom - 17} Z`
  return (
    <g>
      <g transform={`translate(${side * 2} 3)`} fill="#150d08" opacity="0.16">
        <path d={tail} />
        <rect x={left} y={top} width={w} height={h} rx="10" />
      </g>
      <g fill="#fdf6e3" opacity="0.97">
        <path d={tail} />
        <rect x={left} y={top} width={w} height={h} rx="10" />
      </g>
      <g transform={`translate(${left} ${top})`}>{children}</g>
    </g>
  )
}

/** Above a working priest: what he is doing, in full. `compact`: a narrower wrap for a mobile column. */
function DoingBubble({ text, side, compact }: { text: string; side: 1 | -1; compact?: boolean }) {
  const lines = wrapAll(text, compact ? 15 : 20)
  const lh = 14
  const pad = 8
  const w = compact ? 112 : 148
  const h = lines.length * lh + pad * 2
  return (
    <Callout w={w} h={h} side={side} near={compact ? 34 : 56}>
      {lines.map((l, i) => (
        <text key={i} x={w / 2} y={pad + lh * (i + 1) - 4} textAnchor="middle" className="bubble-text">
          {l}
        </text>
      ))}
    </Callout>
  )
}

/** What he did and what he waits for, beside his head, in full. `compact`: a narrower wrap for a mobile column. */
function RecapBubble({ done, next, side, compact }: { done: string; next: string; side: 1 | -1; compact?: boolean }) {
  // Always the whole text: more lines rather than a cut.
  const doneLines = wrapAll(`✓ ${done}`, compact ? 15 : 20)
  const nextLines = wrapAll(`→ ${next}`, compact ? 15 : 20)
  const lh = 13
  const pad = 7
  const w = compact ? 118 : 156
  const h1 = doneLines.length * lh + pad * 2
  const h2 = nextLines.length * lh + pad * 2
  return (
    <Callout w={w} h={h1 + h2} side={side} near={compact ? 34 : 56}>
      <line x1="6" x2={w - 6} y1={h1} y2={h1} stroke="#e0c98f" />
      {doneLines.map((l, i) => (
        <text key={`d${i}`} x="8" y={pad + lh * (i + 1) - 4} className="recap-text">
          {l}
        </text>
      ))}
      {nextLines.map((l, i) => (
        <text key={`n${i}`} x="8" y={h1 + pad + lh * (i + 1) - 4} className="recap-text recap-next-text">
          {l}
        </text>
      ))}
    </Callout>
  )
}

/** A novice (subagent) meditating at his master's feet, with the icon of his current tool. */
function Novice({ n, profile, x, y, onSelect }: { n: NoviceSummary; profile: MonkProfile; x: number; y: number; onSelect: () => void }) {
  return (
    <motion.g
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="novice clickable"
      role="button"
      tabIndex={0}
      aria-label={`${profile.name} (${n.agentType}) : ${n.description}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
    >
      <title>{`${profile.name} · ${n.description}${n.lastTool ? `\n${n.lastTool.tool} ${n.lastTool.summary}` : ''}`}</title>
      <g transform={`translate(${x} ${y})`}>
        <ellipse rx="13" ry="4" fill="#00000040" />
        <path d="M-9 0 L-10 -26 Q0 -36 10 -26 L9 0 Z" fill={profile.robe} />
        <circle cy="-34" r="6" fill="#d9a577" />
        <motion.text y="-46" textAnchor="middle" fontSize="11" animate={{ y: [-46, -50, -46] }} transition={{ duration: 1.2, repeat: Infinity }}>
          {n.lastTool ? toolIcon(n.lastTool.tool) : '🙏'}
        </motion.text>
      </g>
    </motion.g>
  )
}

export function Priest({
  x,
  y,
  scale,
  session,
  robe,
  title,
  profiles,
  selected,
  onSelect,
  onSelectNovice,
  onIncense,
  bubbleSide = 1,
  compact = false,
}: {
  x: number
  y: number
  scale: number
  session: SessionSummary
  robe: string
  title: string
  profiles: MonkProfile[]
  selected: boolean
  onSelect: () => void
  onSelectNovice: (monkId: string) => void
  /** Click on his incense: choose silence (or relight) or dismissal. */
  onIncense?: () => void
  /** Which side his activity/recap bubble opens on: away from his pavilion behind him. */
  bubbleSide?: 1 | -1
  /** A narrow mobile column: his bubbles wrap tighter so they never run off screen. */
  compact?: boolean
}) {
  const { status } = session
  const working = status === 'working'
  // Waiting for you glows, unless you silenced him (his incense is out).
  const unread = status === 'waiting' && !session.silenced
  const novices = session.novices.slice(0, 4)
  const extra = session.novices.length - novices.length
  // What he is doing, as Haiku sums it up; until then, his current tool.
  // Never raw commands here: the plain sentence, or a plain placeholder until it comes.
  const activity = working
    ? (session.doing ?? (session.novices.length ? `Au travail avec ${session.novices.length} aide${session.novices.length > 1 ? 's' : ''}…` : 'Au travail…'))
    : null
  // A heavy context tires him: from 200K he starts to slump, fully at 800K.
  const level = contextLevel(session.context)
  const tired = session.context == null ? 0 : Math.max(0, Math.min(1, (session.context - 200_000) / 600_000))
  const label = `${title} sur ${session.project}${session.branch ? ` (${session.branch})` : ''} : ${session.title} (${status})${session.external ? ', lancé hors de Sangha' : ''}`
  // He leaves toward the nearest edge of the courtyard.
  const away = x < 500 ? -700 : 700


  return (
    // Slides to his new seat when the rows reflow.
    <motion.g initial={{ x, y }} animate={{ x, y }} transition={{ duration: 0.9, ease: 'easeInOut' }}>
      <g transform={`scale(${scale})`}>
      <motion.g
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: status === 'interrupted' ? 0.55 : 1, scale: 1, x: 0 }}
        exit={{ x: away, opacity: 0, transition: { duration: 2, ease: 'easeIn' } }}
      >
        <motion.g
          className="priest clickable"
          role="button"
          tabIndex={0}
          aria-label={label}
          aria-pressed={selected}
          onClick={onSelect}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
        >
          <title>{label}</title>
          {selected && <ellipse cx="0" cy="0" rx="58" ry="16" fill="none" stroke="#ffe9a8" strokeWidth="2.5" strokeDasharray="6 5" />}
          {/* Halo: he stopped and you have not read his last words yet. */}
          {unread && (
            <motion.ellipse
              cy="-48"
              rx="66"
              ry="84"
              fill="url(#priestHalo)"
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          )}
          <ellipse rx={44 + 8 * tired} ry={12 - 4 * tired} fill="#6e2a1c" />
          {/* The slump holds as long as the context stays heavy; only the breathing below repeats. */}
          <motion.g
            animate={{ rotate: 18 * tired, x: 6 * tired, scaleY: 1 - 0.14 * tired }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            style={{ originX: '50%', originY: '100%' }}
          >
          <motion.g
            animate={working ? { scaleY: [1, 1.03, 1] } : { scaleY: 1 }}
            transition={working ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 1 }}
            style={{ originX: '50%', originY: '100%' }}
          >
            <path d="M-40 -2 L-37 -34 Q0 -78 37 -34 L40 -2 Z" fill={robe} />
            <path d="M-26 -42 Q4 -24 34 -4" fill="none" stroke="#00000045" strokeWidth="8" />
            {/* Joined in meditation; tired, the hands part and slide down toward his knees. */}
            {tired < 0.15 ? (
              <ellipse cy="-20" rx="18" ry="7" fill="#d9a577" />
            ) : (
              [-1, 1].map((side) => (
                <ellipse key={side} cx={side * (6 + 18 * tired)} cy={-20 + 12 * tired} rx={10 - 2 * tired} ry="6.5" fill="#d9a577" />
              ))
            )}
            {/* His head droops a little further to the side than his body. */}
            <g transform={`rotate(${10 * tired} 0 -58)`}>
              <circle cy="-72" r="16" fill="#d9a577" />
              <Eyes y={-72} open={!working} tired={tired} />
            </g>
          </motion.g>
          </motion.g>
          {status === 'error' && (
            <g transform="translate(-50 -52)">
              <ellipse rx="9" ry="12" fill="#c0392b" />
              <text y="4" textAnchor="middle" fontSize="11" fill="#fff">
                !
              </text>
            </g>
          )}
          {status === 'interrupted' && (
            <text x="-50" y="-46" fontSize="18" textAnchor="middle">
              ⟳
            </text>
          )}
          <AnimatePresence>
            {activity && (
              <motion.g key="activity" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <DoingBubble text={activity} side={bubbleSide} compact={compact} />
              </motion.g>
            )}
            {!working && session.recap && (
              <motion.g key="recap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <RecapBubble done={session.recap.done} next={session.recap.next} side={bubbleSide} compact={compact} />
              </motion.g>
            )}
          </AnimatePresence>
          <text y="30" textAnchor="middle" className="scene-name">
            {title}
          </text>
          <text y="48" textAnchor="middle" className="scene-repo">
            {session.external ? '⌨ ' : '⎇ '}
            {session.branch ?? 'sans branche'}
          </text>
          {session.context != null && level && (
            <g transform={`translate(0 58)`} aria-label={`Contexte : ${formatTokens(session.context)} tokens`}>
              <title>{`Contexte : ${formatTokens(session.context)} tokens${session.renewal === 'asked' ? ' · session neuve proposée, en attente de sa réponse' : session.renewal === 'postponed' ? ' · session neuve reportée (redemandé 100K plus loin)' : ''}`}</title>
              <rect x="-40" y="0" width="80" height="5" rx="2.5" fill="#00000055" />
              <rect x="-40" y="0" width={80 * Math.min(1, session.context / 800_000)} height="5" rx="2.5" fill={CONTEXT_COLOR[level]} />
              <text x="46" y="6" className="scene-context" fill={CONTEXT_COLOR[level]}>
                {formatTokens(session.context)}
                {session.renewal === 'asked' ? ' · ↻ ?' : ''}
              </text>
            </g>
          )}
          {session.cost != null && session.cost >= 0.01 && (
            <text y={session.context != null && level ? 78 : 64} textAnchor="middle" className="scene-cost">
              <title>Ce qu'aurait coûté cette session au prix de l'API (sous-agents et sessions précédentes compris). Elle tourne sur ton abonnement.</title>
              {formatCost(session.cost)}
            </text>
          )}
        </motion.g>
        {onIncense && (
          <g transform="translate(46 16)">
            <Incense
              size={0.8}
              lit={!session.silenced}
              label={session.silenced ? 'Encens éteint : il est silencieux. Rallumer ou congédier' : 'Encens : faire silence ou congédier'}
              hint={session.silenced ? 'Rallumer ou congédier' : 'Silence ou congédier'}
              hintSide="above"
              onSnuff={onIncense}
            />
          </g>
        )}
        <AnimatePresence>
          {novices.map((n, i) => {
            // Alternate sides of the cushion, stepping outward and slightly forward.
            const side = i % 2 === 0 ? -1 : 1
            const step = Math.floor(i / 2)
            return (
              <Novice
                key={n.monkId}
                n={n}
                profile={profileFor(n.agentType, profiles)}
                x={side * (60 + step * 24)}
                y={10 + step * 6}
                onSelect={() => onSelectNovice(n.monkId)}
              />
            )
          })}
        </AnimatePresence>
        {extra > 0 && (
          <text x="0" y="80" textAnchor="middle" className="scene-role">
            +{extra} novices
          </text>
        )}
      </motion.g>
      </g>
    </motion.g>
  )
}
