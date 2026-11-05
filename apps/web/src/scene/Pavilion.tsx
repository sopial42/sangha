import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import type { ProjectInfo } from '@sangha/shared'
import { Incense } from './Incense'

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Outline shared by a pavilion and the ghost one: body, curved roof, platform. `w` is the body width. */
const roofPath = (w: number) => `M${-w / 2 - 22} -96 Q${-w / 2 - 4} -102 ${-w / 2 + 4} -124 L${w / 2 - 4} -124 Q${w / 2 + 4} -102 ${w / 2 + 22} -96 Z`

/**
 * A prayer pavilion for one project, standing on the courtyard (origin: center of its base).
 * Its priests sit in front of it. The door glows while one of them works.
 */
export function Pavilion({
  project,
  width,
  working,
  onClick,
  onRemove,
  foot,
}: {
  project: ProjectInfo
  width: number
  working: boolean
  onClick: () => void
  /** Snuffing out the big burner removes the project. Resolves false if it stays (cancelled). */
  onRemove?: () => Promise<boolean>
  /** At its foot, between the building and the big burner: its lotus basin. */
  foot?: ReactNode
}) {
  const [snuffed, setSnuffed] = useState(false)
  // Hovering the door guard below lights the pavilion up as if hovering the pavilion itself.
  const [doorHover, setDoorHover] = useState(false)
  const w = Math.max(90, width)
  const pillars = [-w / 2 + 6, -w / 6, w / 6, w / 2 - 6]
  const label = `Pavillon ${project.name}${project.branch ? ` (${project.branch})` : ''} : ouvrir une session`
  const snuff = async () => {
    setSnuffed(true)
    await new Promise((r) => setTimeout(r, 900))
    if (!(await onRemove?.())) setSnuffed(false)
  }
  return (
    <g>
    <g
      className={`pavilion clickable${doorHover ? ' is-hover' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      <title>{`${project.name}\n${project.path}\nClic : nouvelle session`}</title>
      <rect x={-w / 2 - 14} y="-8" width={w + 28} height="10" rx="2" fill="#6d5644" />
      <rect x={-w / 2} y="-96" width={w} height="88" fill="#2e1913" />
      {/* door, lit from inside while a priest of this project works */}
      <rect x={-w * 0.16} y="-66" width={w * 0.32} height="58" rx="3" fill="#150b09" />
      <motion.rect x={-w * 0.16} y="-66" width={w * 0.32} height="58" rx="3" fill="#ffb347" initial={false} animate={{ opacity: working ? 0.32 : 0.06 }} transition={{ duration: 1.2 }} />
      {pillars.map((x) => (
        <rect key={x} x={x - 5} y="-96" width="10" height="88" fill={project.color} />
      ))}
      <path d={roofPath(w)} fill="url(#roof)" />
      <path d={`M${-w / 2 + 14} -124 Q${-w / 2 + 24} -136 ${-w / 2 + 32} -148 L${w / 2 - 32} -148 Q${w / 2 - 24} -136 ${w / 2 - 14} -124 Z`} fill="#241310" />
      <path d={`M${-w / 2 - 22} -96 Q${-w / 2 - 4} -102 ${-w / 2 + 4} -124 L${w / 2 - 4} -124 Q${w / 2 + 4} -102 ${w / 2 + 22} -96`} fill="none" stroke={project.color} strokeWidth="2.5" />
      {/* name plaque */}
      <rect x={-Math.min(w * 0.42, 70)} y="-92" width={Math.min(w * 0.84, 140)} height="22" rx="3" fill="#1c0f0d" stroke={project.color} strokeWidth="1.5" />
      <text y="-76" textAnchor="middle" className="pavilion-name">
        {clip(project.name, Math.floor(Math.min(w * 0.84, 140) / 9))}
      </text>
    </g>
    {foot}
    {/* the big burner, set down at the pavilion's bottom right corner, beside its basin */}
    {onRemove && (
      <g transform={`translate(${w / 2 + 30} 10)`}>
        <Incense size={1.2} lit={!snuffed} label={`Éteindre le grand encens : retirer ${project.name} du monastère`} hint="Éteindre : retirer le projet" onSnuff={() => void snuff()} />
      </g>
    )}
    {/* Drawn last, over its foot and burner: the burner's sticks, smoke and halo, or a priest on the
        basin's far bank, can rise in front of the door, but a click on the pavilion's body always
        opens a new session — never snuffs the burner by accident. */}
    <rect
      x={-w / 2}
      y="-124"
      width={w}
      height="126"
      fill="transparent"
      style={{ cursor: 'pointer' }}
      aria-hidden="true"
      onClick={onClick}
      onMouseEnter={() => setDoorHover(true)}
      onMouseLeave={() => setDoorHover(false)}
    />
    </g>
  )
}

/** A discreet stone marker beside the pavilions: adds a project. */
export function AddProjectMarker({ onClick }: { onClick: () => void }) {
  return (
    <g
      className="add-project clickable"
      role="button"
      tabIndex={0}
      aria-label="Ajouter un projet"
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      <title>Ajouter un projet</title>
      <circle r="17" fill="#ffffff08" stroke="#b3a38e80" strokeWidth="1.5" strokeDasharray="4 4" />
      <text y="6" textAnchor="middle" className="add-project-plus">
        +
      </text>
    </g>
  )
}
