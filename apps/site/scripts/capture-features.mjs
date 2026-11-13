// Feature crops for the landing page, from demo data only (same /api interception as the README capture).
// Needs `make dev` running and Google Chrome. usage: node apps/site/scripts/capture-features.mjs <outDir>
// Then: feat-usage/remote/feedback.png as is; feat-orchestrator.png is orchestrator-full.png cropped to (560,290)-(2060,1080).
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fixtures, NAMES } from '../../../scripts/readme-screenshot/fixtures.mjs'
const out = process.argv[2]
const D = fixtures(NAMES)
const now = Date.now(), min = 60000
// Push notification copy: handed to claude.ai with Remote Control (a demo link).
const remoteId = D.sessions.find((s) => s.title === 'Push notification copy').id
D.sessions.find((s) => s.id === remoteId).remote = 'https://claude.ai/code/session_demo'
let seq = 0
const ev = (m, e) => ({ seq: ++seq, at: now - m * min, ev: e })
const orchChat = [
  ev(9, { t: 'session.started', model: 'opus', agents: [], skills: [], plugins: [], claudeSessionId: 'o' }),
  ev(9, { t: 'user.message', text: 'Start a session on billing-api to retry failed webhooks, and tell me which sessions need me.' }),
  ev(8, { t: 'assistant.tool', tool: 'start_session', summary: 'billing-api: Webhook retries' }),
  ev(8, { t: 'assistant.text', text: 'Started **Webhook retries** on billing-api, on its own branch `sangha/webhook-retries`.\n\nTwo sessions are waiting for you:\n\n- **Drop the legacy sessions table** (atlas-web) wants your OK to drop the old table.\n- **Push notification copy** (mobile-app) drafted three versions and wants you to pick one.' }),
  ev(8, { t: 'turn.done', ok: true, costUsdEquiv: 0.06, durationMs: 9000, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sse = (items) => items.map((x) => `data: ${JSON.stringify(x)}\n\n`).join('') + 'retry: 600000\n\n'
function answer(path) {
  const p = path.split('?')[0]
  if (p === '/api/events') return { sse: sse([{ kind: 'snapshot', sessions: D.sessions, quota: D.quota, reserve: D.reserve }]) }
  const m = p.match(/^\/api\/sessions\/([^/]+)\/events$/)
  if (m) return { sse: sse(m[1] === D.focusId ? D.chat : m[1] === 'orchestrator' ? orchChat : []) }
  if (p === '/api/projects') return { json: D.projects }
  if (p === '/api/models') return { json: [{ id: '', label: 'Agent default', engine: 'claude', model: null }] }
  if (p === '/api/git-identity') return { json: { name: 'Dev', email: 'dev@example.com' } }
  if (p === '/api/quota-reserve') return { json: D.reserve }
  if (p === '/api/host') return { status: 503, json: {} }
  if (p === '/api/costs') return { json: { total: 214.6, sessions: 96, since: now - 40 * 86400000, months: [] } }
  return { json: [] }
}
const dir = mkdtempSync('/tmp/claude-1000/feat-chrome-')
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9351', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' })
let ws
for (let i = 0; i < 50 && !ws; i++) { try { const p = (await (await fetch('http://127.0.0.1:9351/json')).json()).find((x) => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl) } catch {} await sleep(200) }
if (ws.readyState !== WebSocket.OPEN) await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    const u = new URL(request.url); const a = answer(u.pathname + u.search)
    send('Fetch.fulfillRequest', { requestId, responseCode: a.status ?? 200, responseHeaders: [{ name: 'content-type', value: a.sse ? 'text/event-stream' : 'application/json' }], body: Buffer.from(a.sse ?? JSON.stringify(a.json)).toString('base64') })
  }
})
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result?.value
const rect = (js) => run(`(() => { const els = (${js}).filter(Boolean); if (!els.length) return null; const rs = els.map(e => e.getBoundingClientRect()); const x = Math.min(...rs.map(r=>r.left)), y = Math.min(...rs.map(r=>r.top)), r = Math.max(...rs.map(r=>r.right)), b = Math.max(...rs.map(r=>r.bottom)); return { x, y, width: r - x, height: b - y } })()`)
async function clip(name, js, pad = 20) {
  const r = await rect(js)
  if (!r) { console.log('MISSING', name); return }
  const c = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2, scale: 1 }
  const s = await send('Page.captureScreenshot', { format: 'png', clip: c })
  writeFileSync(`${out}/${name}.png`, Buffer.from(s.result.data, 'base64')); console.log('ok', name, Math.round(c.width), Math.round(c.height))
}
const byText = (sel, t) => `[...document.querySelectorAll('${sel}')].find(e => e.textContent.includes('${t}'))`
const URL0 = 'http://127.0.0.1:8787/'
await send('Page.navigate', { url: URL0 }); await sleep(1500)
await run(`localStorage.clear(); localStorage.setItem('sangha.groupBy','status'); localStorage.setItem('sangha.sidebarCollapsed','1')`)
// 1. Usage popover
await send('Page.navigate', { url: URL0 }); await sleep(3500)
await run(`${byText('button', 'weekly')}.click()`); await sleep(900)
await clip('usage', `[document.querySelector('[data-slot=popover-content]')]`, 0)
// 2. Orchestrator
await send('Page.navigate', { url: URL0 + '?session=orchestrator' }); await sleep(3500)
await clip('orchestrator', `[document.querySelector('header'), ...document.querySelectorAll('main [data-slot=message], main article, main [role=log]')]`, 0)
await send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(`${out}/orchestrator-full.png`, Buffer.from(s.result.data, 'base64')))
// 3. Remote Control
await send('Page.navigate', { url: URL0 + '?session=' + remoteId }); await sleep(3500)
await run(`document.querySelector('[aria-label="Show QR code"]').click()`); await sleep(900)
await clip('remote', `[document.querySelector('section[aria-label="Remote Control"]'), document.querySelector('[data-slot=popover-content]')]`, 16)
// 4. Feedback comment
await send('Page.navigate', { url: URL0 + '?session=' + D.focusId }); await sleep(3500)
await run(`${byText('button', 'Comment')}.click()`); await sleep(500)
await run(`document.querySelector('[role=group][aria-label^="Your feedback"] input')?.focus()`)
await send('Input.insertText', { text: 'Run the tests before asking.' }); await sleep(400)
await clip('feedback', `[document.querySelector('[role=group][aria-label^="Your feedback"]')]`, 16)
await send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(`${out}/focus-full.png`, Buffer.from(s.result.data, 'base64')))
ws.close(); chrome.kill()
