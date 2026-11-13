import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SPRITES, type SpriteKey } from '@/assets/pebbles'
import type { Ring } from '@/lib/sessions'

/** A pebble's body is this many CSS pixels wide at scale 1. */
const BODY_WIDTH = 100

/**
 * A pebble standing on the board. (x, y) is the floor point it rests on, in the board's coordinates;
 * the sprite is positioned so its own contact point lands there, whatever its size or cairn.
 */
export function BoardPebble({
  sprite,
  ring = null,
  x,
  y,
  scale = 1,
  motion = null,
  ping = false,
  className,
  imgClassName,
  children,
}: {
  sprite: SpriteKey
  ring?: Ring
  x: number
  y: number
  scale?: number
  /** `land`: it just arrived on the board. `swap`: its state just changed. Null: it was already there as is. */
  motion?: 'land' | 'swap' | null
  /** It just started needing you: one ripple on the floor. */
  ping?: boolean
  className?: string
  /** On the pebble itself, not its floor ring (e.g. a hover highlight). */
  imgClassName?: string
  children?: ReactNode
}) {
  const s = SPRITES[sprite]
  const f = (BODY_WIDTH * scale) / s.bodyW
  const w = s.w * f
  const h = s.h * f
  const style: CSSProperties = { left: x - s.ax * f, top: y - s.ay * f, width: w, height: h }
  return (
    <div className={cn('absolute', motion === 'land' && 'motion-land', className)} style={style}>
      {ring && <PebbleRing ring={ring} ping={ping} cx={s.ax * f} cy={s.ay * f} scale={scale} />}
      {/* Keyed by sprite: a new state mounts a new image, which fades in over the change. */}
      <div className={cn('pointer-events-none absolute inset-0', imgClassName)}>
        <img
          key={sprite}
          src={s.src}
          alt=""
          draggable={false}
          className={cn('absolute inset-0 size-full select-none', motion === 'swap' && 'motion-swap')}
        />
      </div>
      {children}
    </div>
  )
}

/** Floor rings and glows: drawn flat under the pebble, so they can animate without re-rendering it. */
function PebbleRing({ ring, ping, cx, cy, scale }: { ring: Exclude<Ring, null>; ping: boolean; cx: number; cy: number; scale: number }) {
  const rx = 54 * scale
  const ry = 19 * scale
  const pad = 24 * scale
  const w = (rx + pad) * 2
  const h = (ry + pad) * 2
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
      className="pointer-events-none absolute overflow-visible"
      style={{ left: cx - w / 2, top: cy - h / 2 }}
    >
      {/* Working: the glow breathes, slowly, so a busy session reads as alive at a glance. */}
      {ring === 'glow' && <ellipse rx={rx + 10 * scale} ry={ry + 5 * scale} className="fill-stone/25 blur-md motion-breathe" />}
      {ring === 'needs' && (
        <>
          <ellipse rx={rx + 14 * scale} ry={ry + 7 * scale} className="fill-coral/30 blur-lg" />
          <ellipse rx={rx} ry={ry} fill="none" strokeWidth={2.5} className="stroke-coral" />
          {ping && <ellipse rx={rx} ry={ry} fill="none" strokeWidth={2} className="stroke-coral motion-ping" />}
        </>
      )}
      {ring === 'error' && <ellipse rx={rx} ry={ry} fill="none" strokeWidth={2} className="stroke-danger" />}
    </svg>
  )
}

/** A pebble as an icon: sidebar rows, headers, chat avatars, the logo. Shadowless, bigger eyes. */
export function PebbleIcon({ sprite, size = 28, className }: { sprite: SpriteKey; size?: number; className?: string }) {
  const s = SPRITES[sprite]
  return (
    <img
      src={s.src}
      alt=""
      draggable={false}
      width={size}
      height={Math.round((size * s.h) / s.w)}
      className={cn('shrink-0 select-none', className)}
    />
  )
}
