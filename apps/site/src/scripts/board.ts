// The hero's live board: the app's own isometric floor, pebbles and rings, playing a short loop of what
// a day with Sangha looks like. Plain DOM, no framework: it is one small scene.
import { SPRITES } from '@pebbles'

type Key = keyof typeof SPRITES
type State = 'working' | 'needs' | 'done' | 'error' | 'idle'
type Pebble = { id: string; zone: number; slot: [number, number]; title: string; state: State; cairn: number; subs: number }

const BODY = 100 // a pebble's body width at scale 1, as in the app
const SCALE = 0.74
const SVG = 'http://www.w3.org/2000/svg'

// Astro turns image imports into objects with a `src`; Vite alone gives a string. Accept both.
const srcOf = (k: Key) => {
  const s = SPRITES[k].src as unknown
  return typeof s === 'string' ? s : (s as { src: string }).src
}

function spriteOf(p: Pebble): Key {
  if (p.state === 'needs' || p.state === 'done') return 'coral-open'
  if (p.state === 'error') return 'stone-x'
  if (p.state === 'working') return 'stone-closed'
  return (p.cairn > 0 ? `stone-open-cairn${p.cairn}` : 'stone-open') as Key
}

const ZONES = ['atlas-web', 'billing-api', 'mobile-app']

const initial = (): Pebble[] => [
  { id: 'a1', zone: 0, slot: [0, 0], title: 'Drop the legacy sessions table', state: 'working', cairn: 0, subs: 0 },
  { id: 'a2', zone: 0, slot: [-1, 0], title: 'Checkout redesign', state: 'working', cairn: 0, subs: 2 },
  { id: 'a3', zone: 0, slot: [1, 0], title: 'Review checkout flow', state: 'working', cairn: 0, subs: 0 },
  { id: 'b1', zone: 1, slot: [0, 0], title: 'Webhook retries', state: 'working', cairn: 0, subs: 0 },
  { id: 'b2', zone: 1, slot: [1, 0], title: 'Invoice PDF export', state: 'working', cairn: 0, subs: 0 },
  { id: 'b3', zone: 1, slot: [-1, 0], title: 'Terraform plan for staging', state: 'idle', cairn: 1, subs: 0 },
  { id: 'c1', zone: 2, slot: [0, 0], title: 'Push notification copy', state: 'working', cairn: 0, subs: 0 },
  { id: 'c2', zone: 2, slot: [-1, 0], title: 'Offline sync', state: 'working', cairn: 0, subs: 0 },
]

// One change per beat. The loop ends where it started, so it can repeat without a jump.
const SCRIPT: [string, Partial<Pebble>][][] = [
  [['c2', { subs: 1 }]],
  [['a1', { state: 'needs' }]],
  [['c2', { subs: 3 }], ['b3', { cairn: 3 }]],
  [['b1', { state: 'error' }]],
  [['c1', { state: 'done' }]],
  [['a1', { state: 'working' }], ['b3', { cairn: 4 }]],
  [['b1', { state: 'working' }], ['c2', { subs: 0 }]],
  [['b3', { cairn: 5 }]],
  [['c1', { state: 'working' }], ['a2', { subs: 0 }]],
  [['b3', { cairn: 1 }], ['a2', { subs: 2 }]],
]

const STATUS: Record<State, string> = { needs: 'Has a question', done: 'Finished', error: 'Error', working: 'Working', idle: 'Idle' }

type Layout = { w: number; h: number; zones: { cx: number; cy: number; hw: number; hh: number }[]; orch: { x: number; y: number } | null }

function layoutFor(width: number): Layout {
  if (width >= 820) {
    const hw = 168
    const hh = hw / 2
    const cy = 318
    return { w: 1200, h: 470, zones: [-1, 0, 1].map((c) => ({ cx: 600 + c * 2.12 * hw, cy, hw, hh })), orch: { x: 600, y: 112 } }
  }
  // Narrow screens: one zone, larger, so the pebbles stay readable.
  const hw = 190
  return { w: 520, h: 360, zones: [{ cx: 260, cy: 220, hw, hh: hw / 2 }], orch: null }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', style: Partial<CSSStyleDeclaration> = {}) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  Object.assign(e.style, style)
  return e
}
function svg(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export function mountBoard(root: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let pebbles = initial()
  let beat = 0
  let timer = 0
  let layout = layoutFor(root.clientWidth)
  const stage = el('div', 'absolute left-0 top-0 origin-top-left')
  root.append(stage)
  const views = new Map<string, { wrap: HTMLElement; img: HTMLImageElement; ring: SVGSVGElement; subs: HTMLElement[]; key: Key; state: State }>()
  const labels: HTMLElement[] = []

  const visible = () => pebbles.filter((p) => layout.zones[p.zone] !== undefined || layout.zones.length === 1)
  const zoneOf = (p: Pebble) => (layout.zones.length === 1 ? (p.zone === 0 ? layout.zones[0] : null) : layout.zones[p.zone])

  function place(p: Pebble) {
    const z = zoneOf(p)!
    const [i, j] = p.slot
    const k = z.hw / 168
    return { x: z.cx + (i - j) * 62 * k, y: z.cy + (i + j) * 31 * k - 6 }
  }

  function ringFor(state: State, ping: boolean, scale: number) {
    const rx = 54 * scale
    const ry = 19 * scale
    const pad = 24 * scale
    const w = (rx + pad) * 2
    const h = (ry + pad) * 2
    const s = svg('svg', { width: w, height: h, viewBox: `${-w / 2} ${-h / 2} ${w} ${h}`, 'aria-hidden': 'true' }) as SVGSVGElement
    s.style.cssText = `position:absolute;overflow:visible;pointer-events:none;width:${w}px;height:${h}px`
    s.dataset.w = String(w)
    s.dataset.h = String(h)
    if (state === 'working') {
      const g = svg('ellipse', { rx: rx + 10 * scale, ry: ry + 5 * scale, fill: 'rgb(217 212 203 / 0.22)', class: 'motion-breathe' })
      ;(g as SVGElement).style.filter = 'blur(10px)'
      s.append(g)
    }
    if (state === 'needs' || state === 'done') {
      const g = svg('ellipse', { rx: rx + 14 * scale, ry: ry + 7 * scale, fill: 'rgb(242 120 92 / 0.3)' })
      ;(g as SVGElement).style.filter = 'blur(14px)'
      s.append(g, svg('ellipse', { rx, ry, fill: 'none', stroke: '#f2785c', 'stroke-width': 2.5 }))
      if (ping) s.append(svg('ellipse', { rx, ry, fill: 'none', stroke: '#f2785c', 'stroke-width': 2, class: 'motion-ping' }))
    }
    if (state === 'error') s.append(svg('ellipse', { rx, ry, fill: 'none', stroke: '#f06a6e', 'stroke-width': 2 }))
    return s
  }

  function spriteBox(key: Key, x: number, y: number, scale: number) {
    const s = SPRITES[key]
    const f = (BODY * scale) / s.bodyW
    return { left: x - s.ax * f, top: y - s.ay * f, w: s.w * f, h: s.h * f, cx: s.ax * f, cy: s.ay * f }
  }

  function subStone(x: number, y: number, i: number, scale: number, animate: boolean) {
    const b = spriteBox('stone-closed', x + (62 + i * 15) * scale, y - (18 - i * 10) * scale, scale * 0.36)
    const img = el('img', 'absolute select-none', { left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px` })
    img.src = srcOf('stone-closed')
    img.alt = ''
    img.draggable = false
    if (animate && !reduced) {
      img.style.opacity = '0'
      img.style.transform = 'translateY(-14px)'
      img.style.transition = 'opacity 320ms var(--ease-out-strong), transform 420ms var(--ease-out-strong)'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        img.style.opacity = '1'
        img.style.transform = 'none'
      }))
    }
    return img
  }

  function drawFloor() {
    stage.replaceChildren()
    views.clear()
    labels.length = 0
    const { w, h, zones, orch } = layout
    stage.style.width = `${w}px`
    stage.style.height = `${h}px`
    const floor = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' })
    ;(floor as SVGElement).style.cssText = 'position:absolute;inset:0;overflow:visible'
    if (orch) {
      for (const z of zones) floor.append(svg('path', { d: `M${orch.x} ${orch.y + 18} L${z.cx} ${z.cy - z.hh + 8}`, stroke: '#2f2f33', 'stroke-width': 1.1, fill: 'none' }))
    }
    zones.forEach((z, n) => {
      const { cx, cy, hw, hh } = z
      const t = 10
      const top = `${cx - hw},${cy} ${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh}`
      const side = `${cx - hw},${cy} ${cx},${cy + hh} ${cx + hw},${cy} ${cx + hw},${cy + t} ${cx},${cy + hh + t} ${cx - hw},${cy + t}`
      const g = svg('g', { 'stroke-linejoin': 'round', 'stroke-width': 14 })
      g.append(svg('polygon', { points: side, fill: '#141415', stroke: '#141415' }), svg('polygon', { points: top, fill: '#1e1e20', stroke: '#1e1e20' }))
      floor.append(g, svg('polygon', { points: top, fill: 'none', stroke: '#2a2a2d', 'stroke-width': 1, 'stroke-linejoin': 'round' }))
      const fs = zones.length === 1 ? 24 : 22
      const text = svg('text', {
        transform: `matrix(0.894,0.447,-0.894,0.447,${cx - hw + 0.14 * hw + 18},${cy + 0.14 * hh + 1})`,
        'font-size': fs,
        'font-weight': 600,
        fill: '#7a7a80',
        'font-family': 'Inter Variable, sans-serif',
      })
      text.textContent = ZONES[n]!
      floor.append(text)
    })
    stage.append(floor)
    if (orch) {
      const b = spriteBox('stone-open-cairn3', orch.x, orch.y, 0.62)
      const img = el('img', 'absolute select-none', { left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px` })
      img.src = srcOf('stone-open-cairn3')
      img.alt = ''
      stage.append(img)
    }
    // Back to front, so nearer pebbles overlap farther ones.
    const order = visible()
      .filter((p) => zoneOf(p))
      .sort((a, b) => place(a).y - place(b).y)
    for (const p of order) drawPebble(p, false)
    zones.forEach((z) => {
      const label = el('div', 'absolute flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card/95 px-3 py-1.5 text-[13px] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)]', {
        left: `${z.cx}px`,
        top: `${z.cy - z.hh - 84}px`,
        transform: 'translate(-50%, 4px)',
        opacity: '0',
        transition: 'opacity 260ms var(--ease-out-strong), transform 260ms var(--ease-out-strong)',
      })
      labels.push(label)
      stage.append(label)
    })
    updateLabels()
  }

  function drawPebble(p: Pebble, animate: boolean) {
    const { x, y } = place(p)
    const key = spriteOf(p)
    const b = spriteBox(key, x, y, SCALE)
    const wrap = el('div', 'absolute', { left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px` })
    const ring = ringFor(p.state, false, SCALE)
    ring.style.left = `${b.cx - Number(ring.dataset.w) / 2}px`
    ring.style.top = `${b.cy - Number(ring.dataset.h) / 2}px`
    const img = el('img', 'absolute inset-0 size-full select-none')
    img.src = srcOf(key)
    img.alt = ''
    img.draggable = false
    wrap.append(ring, img)
    stage.append(wrap)
    const subs: HTMLElement[] = []
    for (let i = 0; i < p.subs; i++) {
      const s = subStone(x, y, i, SCALE, animate)
      subs.push(s)
      stage.append(s)
    }
    views.set(p.id, { wrap, img, ring, subs, key, state: p.state })
  }

  function update(p: Pebble) {
    const v = views.get(p.id)
    if (!v || !zoneOf(p)) return
    const { x, y } = place(p)
    const key = spriteOf(p)
    if (key !== v.key) {
      // The new state mounts over the old one and fades in, edges softened, like in the app.
      const b = spriteBox(key, x, y, SCALE)
      Object.assign(v.wrap.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px` })
      const next = el('img', 'absolute inset-0 size-full select-none')
      next.src = srcOf(key)
      next.alt = ''
      if (!reduced) {
        next.style.cssText += ';opacity:0;filter:blur(2px);transition:opacity 220ms ease, filter 220ms ease'
        requestAnimationFrame(() => requestAnimationFrame(() => {
          next.style.opacity = '1'
          next.style.filter = 'none'
        }))
      }
      const old = v.img
      v.wrap.append(next)
      setTimeout(() => old.remove(), 240)
      v.img = next
      v.key = key
    }
    if (p.state !== v.state || key !== v.key) {
      const b = spriteBox(key, x, y, SCALE)
      const ring = ringFor(p.state, p.state === 'needs' || p.state === 'done', SCALE)
      ring.style.left = `${b.cx - Number(ring.dataset.w) / 2}px`
      ring.style.top = `${b.cy - Number(ring.dataset.h) / 2}px`
      v.ring.replaceWith(ring)
      v.ring = ring
      v.state = p.state
    }
    while (v.subs.length < p.subs) {
      const s = subStone(x, y, v.subs.length, SCALE, true)
      v.subs.push(s)
      v.wrap.after(s)
    }
    while (v.subs.length > p.subs) {
      const s = v.subs.pop()!
      s.style.transition = 'opacity 180ms ease'
      s.style.opacity = '0'
      setTimeout(() => s.remove(), 200)
    }
  }

  function updateLabels() {
    layout.zones.forEach((_, n) => {
      const label = labels[n]!
      const here = pebbles.filter((p) => p.zone === n)
      const rank = (p: Pebble) => (p.state === 'error' ? 3 : p.state === 'needs' ? 2 : p.state === 'done' ? 1.5 : p.cairn >= 5 ? 1 : 0)
      const top = [...here].sort((a, b) => rank(b) - rank(a))[0]
      if (!top || rank(top) === 0) {
        label.style.opacity = '0'
        label.style.transform = 'translate(-50%, 4px)'
        return
      }
      const status = top.cairn >= 5 && top.state === 'idle' ? 'Ready to start fresh' : STATUS[top.state]
      const dot = top.state === 'error' ? 'bg-danger' : top.state === 'idle' ? 'bg-stone' : 'bg-coral'
      const tone = top.state === 'error' ? 'text-danger' : top.state === 'idle' ? 'text-muted' : 'text-coral'
      label.innerHTML = `<span class="size-1.5 rounded-full ${dot}"></span><span class="font-medium text-fg">${top.title}</span><span class="${tone}">${status}</span>`
      label.style.opacity = '1'
      label.style.transform = 'translate(-50%, 0)'
    })
  }

  function step() {
    const changes = SCRIPT[beat % SCRIPT.length]!
    for (const [id, patch] of changes) {
      const p = pebbles.find((q) => q.id === id)!
      Object.assign(p, patch)
      update(p)
    }
    updateLabels()
    beat++
    if (beat % SCRIPT.length === 0) pebbles = pebbles.map((p) => ({ ...p })) // same state as the start; keep going
  }

  function fit() {
    const next = layoutFor(root.clientWidth)
    if (next.w !== layout.w) {
      layout = next
      drawFloor()
    }
    const k = root.clientWidth / layout.w
    stage.style.transform = `scale(${k})`
    root.style.height = `${layout.h * k}px`
  }

  drawFloor()
  fit()
  new ResizeObserver(fit).observe(root)

  // Plays only while on screen; with reduced motion, the board holds one telling frame instead.
  if (reduced) {
    for (let i = 0; i < 3; i++) step()
    return
  }
  let running = false
  const run = (on: boolean) => {
    if (on === running) return
    running = on
    clearInterval(timer)
    if (on) timer = window.setInterval(step, 2400)
  }
  new IntersectionObserver(([e]) => run(e!.isIntersecting && !document.hidden)).observe(root)
  document.addEventListener('visibilitychange', () => run(!document.hidden && root.getBoundingClientRect().bottom > 0))
  setTimeout(step, 900)
}
