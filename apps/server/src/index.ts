import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Envelope, GlobalEvent, Provider } from '@sangha/shared'
import { buddhaOptions } from './buddha'
import { assertQuotaOnly, config } from './config'
import { probeModels } from './providers'
import { Store } from './db'
import { branches } from './git'
import { profiles } from './monks'
import { readNewLines, readTailLines } from './files'
import { EXTERNAL_PREFIX, Observer } from './observer'
import { Projects } from './projects'
import { type CreateSession, Sessions, UserError } from './session'
import { noviceLog, parseLine, TranscriptReader } from './transcript'

assertQuotaOnly()

const store = new Store(config.dbPath)
const projects = new Projects(store)
const sessions = new Sessions(store, projects, (s) => buddhaOptions(s, projects))
const observer = new Observer(
  store,
  projects,
  () => store.claudeSessionIds(),
  (changed, removed) => sessions.externalChanged(changed, removed),
  () => sessions.projectsChanged(),
  (cwd) => sessions.externalStoppedWorking(cwd),
)
sessions.observe(observer)
observer.start()
sessions.startDoingLoop()
sessions.startRenewalLoop()
sessions.startPullsLoop()

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof UserError) return c.json({ error: err.message }, 400)
  console.error(err)
  return c.json({ error: err.message }, 500)
})

app.get('/api/health', (c) => c.json({ ok: true }))
app.get('/api/monks', (c) => c.json(profiles()))
app.get('/api/models', async (c) => c.json(await sessions.providers.choices()))
app.get('/api/providers', (c) => c.json(sessions.providers.all()))
app.post('/api/providers', async (c) => {
  const p = await c.req.json<Partial<Provider>>()
  if (!p.name?.trim() || !p.baseUrl?.trim()) throw new UserError('nom et URL requis')
  const provider: Provider = {
    id: p.id || `p${crypto.randomUUID().slice(0, 8)}`,
    name: p.name.trim(),
    baseUrl: p.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: p.apiKey?.trim() ?? '',
    authToken: p.authToken?.trim() ?? '',
    timeoutMs: Number(p.timeoutMs) || 3_000_000,
    models: p.models?.length ? p.models.map((m) => m.trim()).filter(Boolean) : null,
  }
  sessions.providers.save(provider)
  return c.json(provider)
})
app.post('/api/providers/:id/remove', (c) => {
  sessions.providers.remove(c.req.param('id'))
  return c.body(null, 204)
})
// The models an endpoint lists, to choose among before saving it.
app.post('/api/providers/probe', async (c) => {
  const p = await c.req.json<Pick<Provider, 'baseUrl' | 'apiKey' | 'authToken'>>()
  try {
    return c.json(await probeModels(p))
  } catch (err) {
    throw new UserError(`liste des modèles introuvable : ${err instanceof Error ? err.message : err}`)
  }
})

app.get('/api/projects', async (c) => c.json(await projects.list()))
// A project is either a local folder (registered where it is) or a git URL (cloned into workspaces/).
app.post('/api/projects', async (c) => {
  const { gitUrl, path, name } = await c.req.json<{ gitUrl?: string; path?: string; name?: string }>()
  if (!gitUrl?.trim() && !path?.trim()) throw new UserError('chemin ou URL git manquant')
  try {
    const created = path?.trim() ? projects.addLocal(path.trim(), name?.trim()) : await projects.add(gitUrl!.trim(), name?.trim())
    sessions.projectsChanged()
    return c.json({ name: created }, 201)
  } catch (e) {
    throw new UserError((e as Error).message)
  }
})
app.delete('/api/projects/:name', async (c) => {
  const result = await sessions.removeProject(c.req.param('name'), c.req.query('force') === '1')
  console.log(`☸ remove project ${c.req.param('name')}: ${result.ok ? 'gone' : 'needs confirmation'}`)
  return result.ok ? c.body(null, 204) : c.json(result, 409)
})
// A local project whose folder moved or was renamed: point it at its new folder.
app.patch('/api/projects/:name', async (c) => {
  const { path } = await c.req.json<{ path?: string }>()
  if (!path?.trim()) throw new UserError('chemin manquant')
  try {
    await projects.relocate(c.req.param('name'), path.trim())
    sessions.projectsChanged()
    return c.json({ name: c.req.param('name'), path: projects.dir(c.req.param('name')) })
  } catch (e) {
    throw new UserError((e as Error).message)
  }
})
app.get('/api/projects/suggestions', async (c) => c.json(await projects.suggestions()))
app.get('/api/projects/:name/branches', async (c) => {
  if (!projects.exists(c.req.param('name'))) return c.json({ error: 'not found' }, 404)
  return c.json(await branches(projects.dir(c.req.param('name'))))
})


app.get('/api/sessions', (c) => c.json(sessions.summaries()))
app.post('/api/sessions', async (c) => {
  const body = await c.req.json<CreateSession>()
  return c.json(await sessions.create(body), 201)
})
app.post('/api/sessions/:id/messages', async (c) => {
  const { text } = await c.req.json<{ text: string }>()
  if (!text?.trim()) throw new UserError('message vide')
  return c.json(await sessions.reply(c.req.param('id'), text.trim()), 202)
})
app.post('/api/sessions/:id/interrupt', async (c) => {
  await sessions.interrupt(c.req.param('id'))
  return c.body(null, 202)
})
app.post('/api/sessions/:id/resume', (c) => {
  sessions.resume(c.req.param('id'))
  return c.body(null, 202)
})
app.get('/api/sessions/:id/progress', async (c) => {
  if (!sessions.summaryOf(c.req.param('id'))) return c.json({ error: 'not found' }, 404)
  return c.json({ progress: await sessions.progressOf(c.req.param('id'), c.req.query('fresh') === '1') })
})
// A novice of an outside session: his own transcript (Sangha's novices stream with their priest).
app.get('/api/sessions/:id/novices/:monkId/log', (c) => {
  const file = observer.noviceFile(c.req.param('id'), c.req.param('monkId'))
  if (!file) return c.json({ log: [] })
  return c.json({ log: noviceLog(readTailLines(file, 4 * 1024 * 1024).map(parseLine).filter((l) => l !== null)) })
})
app.post('/api/sessions/:id/renew', async (c) => {
  await sessions.askRenewal(c.req.param('id'))
  return c.body(null, 202)
})
// Buddha sees him through to a fresh session (or stops).
app.post('/api/sessions/:id/shepherd', async (c) => {
  const { on } = await c.req.json<{ on: boolean }>()
  return c.json(sessions.shepherd(c.req.param('id'), on))
})
app.post('/api/sessions/:id/silence', async (c) => {
  const { silent } = await c.req.json<{ silent: boolean }>()
  sessions.silence(c.req.param('id'), !!silent)
  return c.body(null, 204)
})
app.post('/api/sessions/:id/queued/:mid', async (c) => {
  const { text } = await c.req.json<{ text: string }>()
  sessions.editQueued(c.req.param('id'), c.req.param('mid'), text ?? '')
  return c.body(null, 204)
})
app.post('/api/sessions/:id/queued/:mid/withdraw', (c) => {
  sessions.withdrawQueued(c.req.param('id'), c.req.param('mid'))
  return c.body(null, 204)
})
app.post('/api/sessions/:id/queued/:mid/now', (c) => {
  sessions.sendQueuedNow(c.req.param('id'), c.req.param('mid'))
  return c.body(null, 204)
})
app.post('/api/sessions/:id/model', async (c) => {
  const { model } = await c.req.json<{ model: string }>()
  await sessions.setModel(c.req.param('id'), model ?? '')
  return c.body(null, 204)
})
app.post('/api/sessions/:id/reminder', async (c) => {
  const { text } = await c.req.json<{ text: string | null }>()
  sessions.reminder(c.req.param('id'), text)
  return c.body(null, 204)
})
app.post('/api/sessions/:id/note', async (c) => {
  const { note } = await c.req.json<{ note: string | null }>()
  sessions.note(c.req.param('id'), note)
  return c.body(null, 204)
})
app.post('/api/sessions/:id/restart', async (c) => {
  await sessions.restart(c.req.param('id'))
  return c.body(null, 204)
})
// Opens your browser on the server's OAuth page and answers once you authorized (or gave up).
app.post('/api/sessions/:id/mcp/login', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  return c.json(await sessions.loginMcp(c.req.param('id'), name))
})
app.get('/api/sessions/:id/mcp', async (c) => c.json(await sessions.mcp(c.req.param('id'))))
app.post('/api/sessions/:id/mcp', async (c) => {
  const { name, enabled } = await c.req.json<{ name: string; enabled: boolean }>()
  return c.json(await sessions.toggleMcp(c.req.param('id'), name, !!enabled))
})
app.post('/api/sessions/:id/seen', (c) => {
  sessions.seen(c.req.param('id'))
  return c.body(null, 202)
})
app.delete('/api/sessions/:id', async (c) => {
  const result = await sessions.archive(c.req.param('id'), c.req.query('force') === '1')
  console.log(`☸ dismiss ${c.req.param('id').slice(0, 8)}: ${result.ok ? 'gone' : 'needs confirmation'} (${c.req.header('user-agent')?.slice(0, 60) ?? '?'})`)
  return result.ok ? c.body(null, 204) : c.json(result, 409)
})
app.post('/api/sessions/:id/reincarnate', async (c) => c.json(await sessions.reincarnate(c.req.param('id'))))

// The moon: priests sent to nirvana, newest dismissal first.
app.get('/api/nirvana', (c) => c.json(sessions.nirvana()))

// What the monastery has cost at API prices since monitoring began.
app.get('/api/costs', (c) => c.json(sessions.costReport()))

/** Wait for the next item, sending a keepalive ping every 15 s. */
async function drain<T>(stream: SSEStreamingApi, queue: T[], send: (item: T) => Promise<void>, onWake: (wake: () => void) => void) {
  while (!stream.aborted) {
    const item = queue.shift()
    if (item !== undefined) await send(item)
    else
      await Promise.race([
        new Promise<void>((r) => onWake(r)),
        stream.sleep(15_000).then(() => stream.writeSSE({ event: 'ping', data: '' })),
      ])
  }
}

// Monastery-wide stream: a snapshot of every session, then their changes.
app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const queue: GlobalEvent[] = [{ kind: 'snapshot', sessions: sessions.summaries(), quota: sessions.quota }]
    let wake: (() => void) | null = null
    const unsubscribe = sessions.subscribeAll((ev) => {
      queue.push(ev)
      wake?.()
    })
    stream.onAbort(() => {
      unsubscribe()
      wake?.()
    })
    await drain(stream, queue, (ev) => stream.writeSSE({ data: JSON.stringify(ev) }), (w) => (wake = w))
  }),
)

// An outside session: its Claude Code transcript, read as events, then followed as it grows.
function transcriptStream(c: Context, file: string) {
  return streamSSE(c, async (stream) => {
    const reader = new TranscriptReader()
    let seq = 0
    // Only the recent part of long transcripts: opening a session must be quick.
    let offset = Math.max(0, statSync(file).size - 3 * 1024 * 1024)
    let aborted = false
    stream.onAbort(() => {
      aborted = true
    })
    while (!aborted) {
      const { lines, offset: next } = readNewLines(file, offset)
      offset = next
      for (const raw of lines) {
        const line = parseLine(raw)
        if (!line) continue
        const at = line.timestamp ? Date.parse(line.timestamp) : Date.now()
        for (const ev of reader.push(line)) await stream.writeSSE({ id: String(++seq), data: JSON.stringify({ seq, at, ev } satisfies Envelope) })
      }
      await stream.sleep(2000)
    }
  })
}

// One session: backlog from ?after=seq (or Last-Event-ID), then live events.
app.get('/api/sessions/:id/events', (c) => {
  const id = c.req.param('id')
  if (id.startsWith(EXTERNAL_PREFIX)) {
    const file = observer.fileOf(id)
    return file ? transcriptStream(c, file) : c.json({ error: 'not found' }, 404)
  }
  if (!store.getSession(id)) return c.json({ error: 'not found' }, 404)
  const after = Number(c.req.header('Last-Event-ID') ?? c.req.query('after') ?? 0)
  return streamSSE(c, async (stream) => {
    const queue: Envelope[] = []
    let wake: (() => void) | null = null
    const unsubscribe = sessions.subscribe(id, (env) => {
      queue.push(env)
      wake?.()
    })
    stream.onAbort(() => {
      unsubscribe()
      wake?.()
    })
    let last = after
    const send = async (env: Envelope) => {
      if (env.seq <= last) return
      last = env.seq
      await stream.writeSSE({ id: String(env.seq), data: JSON.stringify(env) })
    }
    for (const env of store.events(id, after)) await send(env)
    await drain(stream, queue, send, (w) => (wake = w))
  })
})

// In Docker the server also serves the built web app.
const webDist = resolve(process.env.SANGHA_WEB_DIST ?? join(import.meta.dirname, '../../web/dist'))
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }))
  app.get('/*', serveStatic({ path: join(webDist, 'index.html') }))
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.HOST ?? '127.0.0.1' }, (i) =>
  console.log(`☸ Sangha on http://${i.address}:${i.port} — workspaces: ${config.workspacesDir}`),
)

const shutdown = () => {
  observer.stop()
  sessions.closeAll()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
