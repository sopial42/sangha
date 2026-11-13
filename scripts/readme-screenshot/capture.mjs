// Captures the app with demo data for the README: every /api call is answered here (Chrome DevTools
// Fetch domain), so no real project or session ever shows. Needs `make dev` running and Google Chrome.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fixtures, NAMES } from './fixtures.mjs'

const [outDir, W = '1440', H = '900'] = process.argv.slice(2)
const D = fixtures(NAMES)
const URL = 'http://127.0.0.1:8787/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sse = (items) => items.map((x) => `data: ${JSON.stringify(x)}\n\n`).join('') + 'retry: 600000\n\n'
function answer(path) {
  const p = path.split('?')[0]
  if (p === '/api/events') return { sse: sse([{ kind: 'snapshot', sessions: D.sessions, quota: D.quota, reserve: D.reserve }]) }
  const m = p.match(/^\/api\/sessions\/([^/]+)\/events$/)
  if (m) return { sse: sse(m[1] === D.focusId ? D.chat : []) }
  if (p === '/api/projects') return { json: D.projects }
  if (p === '/api/models')
    return { json: [{ id: '', label: 'Agent default', engine: 'claude', model: null }, { id: 'opus', label: 'Opus 5.5', engine: 'claude', model: 'opus' }, { id: 'sonnet', label: 'Sonnet 5.5', engine: 'claude', model: 'sonnet' }] }
  if (p === '/api/git-identity') return { json: { name: 'Dev', email: 'dev@example.com' } }
  if (p === '/api/quota-reserve') return { json: D.reserve }
  if (p === '/api/host') return { status: 503, json: {} }
  if (p === '/api/costs') return { json: { total: 214.6, sessions: 96, since: Date.now() - 40 * 86400000, months: [] } }
  return { json: [] }
}

const dir = mkdtempSync('/tmp/claude-1000/demo-chrome-')
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9334', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' })
let ws
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const p = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((x) => x.type === 'page')
    if (p) ws = new WebSocket(p.webSocketDebuggerUrl)
  } catch {}
  await sleep(200)
}
if (ws.readyState !== WebSocket.OPEN) await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    const a = answer(new globalThis.URL(request.url).pathname + new globalThis.URL(request.url).search)
    const body = a.sse ?? JSON.stringify(a.json)
    const type = a.sse ? 'text/event-stream' : 'application/json'
    send('Fetch.fulfillRequest', { requestId, responseCode: a.status ?? 200, responseHeaders: [{ name: 'content-type', value: type }], body: Buffer.from(body).toString('base64') })
  }
})
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] })
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 2, mobile: Number(W) < 768 })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true })

// localStorage first: sidebar open, details panel open, grouped by status.
await send('Page.navigate', { url: URL })
await sleep(1500)
await run(`localStorage.clear(); localStorage.setItem('sangha.groupBy','status')`)
await send('Page.navigate', { url: URL })
await sleep(4000)
await shot('board')
await run(`localStorage.setItem('sangha.sidebarCollapsed', '1'); location.search = '?session=${D.focusId}'`)
await sleep(3000)
await shot('focus')
ws.close()
chrome.kill()
console.log('captured', outDir)
