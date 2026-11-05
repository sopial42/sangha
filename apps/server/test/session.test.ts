import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { BUDDHA_SESSION_ID } from '@sangha/shared'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { config } from '../src/config'
import { LOOP_STOP_MESSAGE, Store, type SessionRow } from '../src/db'
import { QuotaReserveSetting } from '../src/quotaReserve'
import { startRemote } from '../src/remote'
import { RESTARTED, Sessions, UserError } from '../src/session'
import type { Projects } from '../src/projects'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('../src/remote', () => ({ startRemote: vi.fn() }))

/** A fake `Query`: an async-iterable system/assistant message feed you control with `push`, plus spies
 * on the control methods `LiveSession` calls. Draining `options.prompt` (his real inbox) into `sent`
 * lets a test see exactly what text he was asked to say next, in order. */
function mockQuery(sent: string[]) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    // A one-shot small-model call (recap.ts's `ask`, for scripts/doing/progress/recap summaries): a plain
    // string prompt, not a priest's Inbox. It must not fall into the drain loop below (a string is itself
    // iterable, char by char) — answer with no result, exactly like a model that found nothing to say.
    if (typeof prompt === 'string') return { [Symbol.asyncIterator]: async function* () {} } as unknown as Query
    const outbox: unknown[] = []
    let wake: (() => void) | null = null
    let closed = false
    void (async () => {
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) sent.push(m.message.content as string)
    })()
    const fake = {
      [Symbol.asyncIterator]: async function* () {
        for (;;) {
          if (closed) return
          if (outbox.length) yield outbox.shift()
          else await new Promise<void>((r) => (wake = r))
        }
      },
      interrupt: vi.fn().mockResolvedValue(undefined),
      stopTask: vi.fn().mockResolvedValue(undefined),
      // A real `close()` ends his process: the pump loop below must actually see the iterator finish
      // (so `LiveSession.closed` resolves, `onClosed` runs, and he leaves the live map), not stay a no-op.
      close: vi.fn(() => {
        closed = true
        wake?.()
        wake = null
      }),
      mcpServerStatus: vi.fn().mockResolvedValue([]),
      toggleMcpServer: vi.fn().mockResolvedValue(undefined),
      setMcpServers: vi.fn().mockResolvedValue(undefined),
      reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      push: (m: unknown) => {
        outbox.push(m)
        wake?.()
        wake = null
      },
    }
    return fake as unknown as Query & { push: (m: unknown) => void }
  })
}

const tick = () => new Promise((r) => setImmediate(r))

const fakeProjects = { dir: () => '/tmp/sangha-test-project', exists: () => true, agentsOf: () => [] } as unknown as Projects

describe('Sessions autonomy and interrupt', () => {
  let store: Store
  let sessions: Sessions
  let sent: string[]
  let row: SessionRow

  beforeEach(async () => {
    sent = []
    mockQuery(sent)
    store = new Store(':memory:')
    sessions = new Sessions(store, fakeProjects, () => ({}), new QuotaReserveSetting(() => null, () => undefined))
    row = {
      id: 'p1',
      project: 'proj',
      agent: 'claude', // plain Claude: priestOptions('claude') touches no filesystem
      title: 't',
      createdAt: Date.now(),
      claudeSessionId: null,
      branch: null,
      worktree: '/tmp/sangha-test-worktree',
      baseSha: null,
      archivedAt: null,
      lastSeenSeq: 0,
    }
    store.createSession(row)
    sessions.send(row.id, 'hello')
    await tick() // his process starts and reads the first message
  })

  afterEach(() => {
    sessions.closeAll() // lets each test's drained inbox loop end cleanly instead of leaking into the next test
    vi.clearAllMocks()
  })

  it('derives no autonomy before he ever gets a /goal or /loop', () => {
    expect(sessions.summaryOf(row.id)?.autonomy).toBeNull()
  })

  it('sends /goal <text> as a bare slash command, without the standing-instruction reminder', async () => {
    sessions.reminder(row.id, 'sois concis')
    await sessions.autonomy(row.id, { mode: 'goal', text: 'continue jusqu’à la prod' })
    await tick()
    expect(sent.at(-1)).toBe('/goal continue jusqu’à la prod')
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'goal', text: 'continue jusqu’à la prod', active: true })
  })

  it('goes out right away even mid-turn, rather than waiting in the editable queue', async () => {
    // Still mid-turn here: no turn.done was ever emitted since `beforeEach`'s send().
    await sessions.autonomy(row.id, { mode: 'goal', text: 'ship it' })
    await tick()
    expect(sent.at(-1)).toBe('/goal ship it')
    expect(store.queued(row.id)).toEqual([])
  })

  it('stops an active goal outright for a null patch', async () => {
    await sessions.autonomy(row.id, { mode: 'goal', text: 'un objectif' })
    await tick()
    await sessions.autonomy(row.id, null)
    await tick()
    expect(sent.at(-1)).toBe('/goal clear')
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'goal', text: 'un objectif', active: false })
  })

  it('does nothing for a null patch when he never had an autonomy', async () => {
    const before = sent.length
    await sessions.autonomy(row.id, null)
    await tick()
    expect(sent.length).toBe(before)
  })

  it('refuses an autonomy for Buddha', async () => {
    await expect(sessions.autonomy(BUDDHA_SESSION_ID, { mode: 'goal', text: 'x' })).rejects.toThrow(UserError)
  })

  it('refuses an autonomy for an unknown session', async () => {
    await expect(sessions.autonomy('nope', { mode: 'goal', text: 'x' })).rejects.toThrow(UserError)
  })

  it('sends /loop <text> for a self-paced loop (no interval)', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille le déploiement' })
    await tick()
    expect(sent.at(-1)).toBe('/loop surveille le déploiement')
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'surveille le déploiement', interval: null, nextAt: null, active: true })
  })

  it('sends /loop <interval> <text> for a fixed-interval loop', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'vérifie le déploiement', interval: '5m' })
    await tick()
    expect(sent.at(-1)).toBe('/loop 5m vérifie le déploiement')
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'vérifie le déploiement', interval: '5m', nextAt: null, active: true })
  })

  it('stops an active loop outright for a null patch: interrupts his turn, then sends the stop text', async () => {
    const q = vi.mocked(query).mock.results[0]!.value
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille' })
    await tick()
    await sessions.autonomy(row.id, null)
    await tick()
    expect(q.interrupt).toHaveBeenCalledOnce()
    expect(sent.at(-1)).toBe(LOOP_STOP_MESSAGE)
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'surveille', interval: null, nextAt: null, active: false })
  })

  it('switching from an active goal to a loop stops the goal first, never leaving both active', async () => {
    await sessions.autonomy(row.id, { mode: 'goal', text: 'un objectif' })
    await tick()
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille' })
    await tick()
    expect(sent.slice(-2)).toEqual(['/goal clear', '/loop surveille'])
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'surveille', interval: null, nextAt: null, active: true })
  })

  it('switching from an active loop to a goal sends the stop text first, never leaving both active', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille' })
    await tick()
    await sessions.autonomy(row.id, { mode: 'goal', text: 'un objectif' })
    await tick()
    expect(sent.slice(-2)).toEqual([LOOP_STOP_MESSAGE, '/goal un objectif'])
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'goal', text: 'un objectif', active: true })
  })

  it('interrupt stops his background scripts and his live novices, not only his current turn', async () => {
    // A novice (subagent): task_started's own task id differs from his monkId (the summoning tool_use id).
    vi.mocked(query).mock.results[0]!.value.push({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-novice-1',
      tool_use_id: 'toolu_novice',
      task_type: 'local_agent',
      subagent_type: 'reader',
      description: 'lit des fichiers',
      prompt: '',
      spawn_depth: 1,
    })
    // A background script.
    vi.mocked(query).mock.results[0]!.value.push({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'task-script-1', task_type: 'local_bash', description: 'lance les tests' }],
    })
    await tick()
    expect(sessions.summaryOf(row.id)?.novices.map((n) => n.monkId)).toEqual(['toolu_novice'])

    const q = vi.mocked(query).mock.results[0]!.value
    await sessions.interrupt(row.id)
    expect(q.interrupt).toHaveBeenCalledOnce()
    const stoppedIds = q.stopTask.mock.calls.map((c: unknown[]) => c[0])
    expect(stoppedIds.sort()).toEqual(['task-novice-1', 'task-script-1'])
  })

  it('does not let one failing stopTask stop it from stopping the rest', async () => {
    vi.mocked(query).mock.results[0]!.value.push({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'task-a', task_type: 'local_bash', description: 'a' },
        { task_id: 'task-b', task_type: 'local_bash', description: 'b' },
      ],
    })
    await tick()
    const q = vi.mocked(query).mock.results[0]!.value
    q.stopTask.mockRejectedValueOnce(new Error('already gone'))
    await expect(sessions.interrupt(row.id)).resolves.toBeUndefined()
    expect(q.stopTask).toHaveBeenCalledTimes(2)
  })

  it('clears an active /goal on interrupt, so it does not relaunch him', async () => {
    await sessions.autonomy(row.id, { mode: 'goal', text: 'continue jusqu’à la prod' })
    await tick()
    expect(sessions.summaryOf(row.id)?.autonomy?.active).toBe(true)
    await sessions.interrupt(row.id)
    await tick()
    expect(sent.at(-1)).toBe('/goal clear')
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'goal', text: 'continue jusqu’à la prod', active: false })
  })

  it('stops an active loop on interrupt, by sending its stop text (his turn is already being stopped)', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille' })
    await tick()
    expect(sessions.summaryOf(row.id)?.autonomy?.active).toBe(true)
    await sessions.interrupt(row.id)
    await tick()
    expect(sent.at(-1)).toBe(LOOP_STOP_MESSAGE)
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'surveille', interval: null, nextAt: null, active: false })
  })

  it('leaves an already-inactive goal alone on interrupt (no needless /goal clear)', async () => {
    const before = sent.length
    await sessions.interrupt(row.id)
    await tick()
    expect(sent.length).toBe(before)
  })
})

describe('Sessions lotus', () => {
  let store: Store
  let sessions: Sessions
  let row: SessionRow

  beforeEach(async () => {
    mockQuery([])
    store = new Store(':memory:')
    sessions = new Sessions(store, fakeProjects, () => ({}), new QuotaReserveSetting(() => null, () => undefined))
    row = {
      id: 'p1',
      project: 'proj',
      agent: 'claude',
      title: 't',
      createdAt: Date.now(),
      claudeSessionId: null,
      branch: null,
      worktree: '/tmp/sangha-test-worktree',
      baseSha: null,
      archivedAt: null,
      lastSeenSeq: 0,
    }
    store.createSession(row)
    sessions.send(row.id, 'hello')
    await tick()
  })

  afterEach(() => {
    sessions.closeAll()
    vi.clearAllMocks()
  })

  it('starts out of the lotus pond', () => {
    expect(sessions.summaryOf(row.id)?.lotus).toBe(false)
  })

  it('sets a priest aside in the lotus pond and tells every open tab', () => {
    const events: unknown[] = []
    sessions.subscribeAll((e) => events.push(e))
    sessions.lotus(row.id, true)
    expect(sessions.summaryOf(row.id)?.lotus).toBe(true)
    expect(events).toContainEqual({ kind: 'session', session: expect.objectContaining({ id: row.id, lotus: true }) })
  })

  it('takes him back out of the lotus pond', () => {
    sessions.lotus(row.id, true)
    sessions.lotus(row.id, false)
    expect(sessions.summaryOf(row.id)?.lotus).toBe(false)
  })

  it('refuses to set aside an unknown session', () => {
    expect(() => sessions.lotus('nope', true)).toThrow(UserError)
  })
})

const baseRow = (): SessionRow => ({
  id: 'p1',
  project: 'proj',
  agent: 'claude',
  title: 't',
  createdAt: Date.now(),
  claudeSessionId: null,
  branch: null,
  worktree: '/tmp/sangha-test-worktree',
  baseSha: null,
  archivedAt: null,
  lastSeenSeq: 0,
})

/** A `result` SDK message: ends his turn (`turn.done`), the trigger for both the idle-close timer and
 * `BusySettle`'s grace period. */
const resultMessage = () => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } })

describe('Sessions loop re-arming', () => {
  let store: Store
  let sessions: Sessions
  let sent: string[]
  let row: SessionRow

  beforeEach(async () => {
    sent = []
    mockQuery(sent)
    store = new Store(':memory:')
    sessions = new Sessions(store, fakeProjects, () => ({}), new QuotaReserveSetting(() => null, () => undefined))
    row = baseRow()
    store.createSession(row)
    sessions.send(row.id, 'hello')
    await tick() // his process starts and reads the first message
  })

  afterEach(() => {
    sessions.closeAll()
    vi.clearAllMocks()
  })

  it('re-arms an active fixed-interval loop right when a fresh process starts (restart), before anything else', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille le déploiement', interval: '5m' })
    await tick()
    const before = sent.length

    await sessions.restart(row.id)
    await tick()
    await tick() // mcpReady() resolves: the RESTARTED notice follows, but his process is already "turning"
    // (reading the rearm command) so it waits behind it rather than jumping ahead, editable like any other.
    expect(sent.slice(before)).toEqual(['/loop 5m surveille le déploiement'])
    expect(store.queued(row.id).map((m) => m.text)).toEqual([RESTARTED])

    // His turn over (the rearmed /loop handled): the restart notice follows right after, never ahead of it.
    vi.mocked(query).mock.results.at(-1)!.value.push(resultMessage())
    await tick()

    expect(sent.slice(before)).toEqual(['/loop 5m surveille le déploiement', RESTARTED])
    expect(sessions.summaryOf(row.id)?.autonomy).toEqual({ mode: 'loop', text: 'surveille le déploiement', interval: '5m', nextAt: null, active: true })
  })

  it('does not re-arm a self-paced loop that is no longer active', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille' })
    await tick()
    // A turn ends without rescheduling himself (no loop.wake since the /loop message): the loop died quietly.
    vi.mocked(query).mock.results[0]!.value.push(resultMessage())
    await tick()
    expect(sessions.summaryOf(row.id)?.autonomy?.active).toBe(false)
    const before = sent.length

    await sessions.restart(row.id)
    await tick()
    await tick()

    expect(sent.slice(before)).toEqual([RESTARTED])
  })

  it('never re-arms into a process that is already alive: a plain message does not re-send /loop', async () => {
    await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille', interval: '5m' })
    await tick()
    // A fixed-interval loop needs no turn-by-turn reschedule to stay active; ends his turn so the message
    // below is delivered right away rather than queued (a queued message would still be undelivered when
    // the test ends, and `afterEach`'s close would flush it into a stray, test-polluting process start).
    vi.mocked(query).mock.results[0]!.value.push(resultMessage())
    await tick()
    expect(sessions.summaryOf(row.id)?.autonomy?.active).toBe(true)
    const before = sent.length

    sessions.send(row.id, 'coucou')
    await tick()

    expect(sent.slice(before)).toEqual(['coucou'])
  })

  it('never idle-closes a process with an active loop, however long it stays still', async () => {
    const was = config.idleCloseMs
    config.idleCloseMs = 10
    try {
      // Fixed-interval: unlike a self-paced one, it stays active across a quiet turn (no reschedule needed).
      await sessions.autonomy(row.id, { mode: 'loop', text: 'surveille', interval: '5m' })
      await tick()
      vi.mocked(query).mock.results[0]!.value.push(resultMessage())
      await tick()
      expect(sessions.summaryOf(row.id)?.autonomy?.active).toBe(true)
      await new Promise((r) => setTimeout(r, 50)) // real wait, well past idleCloseMs
      const callsBefore = vi.mocked(query).mock.calls.length

      sessions.send(row.id, 'toujours là ?')
      await tick()

      expect(vi.mocked(query).mock.calls.length).toBe(callsBefore) // same process: none was spun up
      expect(sent.at(-1)).toBe('toujours là ?')
    } finally {
      config.idleCloseMs = was
    }
  })

  it('idle-closes normally once still, when there is no active loop (baseline)', async () => {
    const was = config.idleCloseMs
    config.idleCloseMs = 10
    try {
      vi.mocked(query).mock.results[0]!.value.push(resultMessage())
      await tick()
      await new Promise((r) => setTimeout(r, 50))
      const callsBefore = vi.mocked(query).mock.calls.length

      sessions.send(row.id, 'toujours là ?')
      await tick()

      expect(vi.mocked(query).mock.calls.length).toBe(callsBefore + 1) // a fresh process was spun up
    } finally {
      config.idleCloseMs = was
    }
  })
})

describe('Sessions remote control', () => {
  let store: Store
  let sessions: Sessions
  let sent: string[]
  let row: SessionRow

  /** A controllable fake `RemoteControl`: `stop()` ends it synchronously, like a process that exited at once. */
  function fakeRemote() {
    let onExit: (() => void) | null = null
    let resolveClosed: (() => void) | null = null
    const closed = new Promise<void>((r) => (resolveClosed = r))
    vi.mocked(startRemote).mockImplementation(async (_cwd, _claudeSessionId, _name, _env, exit) => {
      onExit = exit
      return {
        url: 'https://claude.ai/code/session_test',
        stop: () => {
          onExit?.()
          resolveClosed?.()
        },
        closed,
      }
    })
  }

  beforeEach(async () => {
    const was = config.settleMs
    config.settleMs = 10 // BusySettle is captured at LiveSession construction: set this before his first send()
    sent = []
    mockQuery(sent)
    store = new Store(':memory:')
    sessions = new Sessions(store, fakeProjects, () => ({}), new QuotaReserveSetting(() => null, () => undefined))
    row = baseRow()
    store.createSession(row)
    sessions.send(row.id, 'hello')
    await tick()
    // Remote Control resumes a Claude session id: give him one, as a real process would on 'init'.
    vi.mocked(query).mock.results[0]!.value.push({ type: 'system', subtype: 'init', session_id: 'claude-sess-1', model: 'x', agents: [], skills: [], plugins: [] })
    await tick()
    config.settleMs = was
  })

  afterEach(() => {
    sessions.closeAll()
    vi.clearAllMocks()
  })

  it('refuses while he is busy at all, even right after a turn just resumed (the settle grace period)', async () => {
    fakeRemote()
    vi.mocked(query).mock.results[0]!.value.push(resultMessage())
    await tick()
    // His turn is over, but BusySettle has not let settleMs elapse yet: still told busy.
    expect(sessions.summaryOf(row.id)?.status).toBe('working')

    await expect(sessions.remoteControl(row.id)).rejects.toThrow(UserError)
  })

  it('a plain message while a remote holds him takes him back, instead of queueing forever', async () => {
    fakeRemote()
    vi.mocked(query).mock.results[0]!.value.push(resultMessage())
    await tick()
    await new Promise((r) => setTimeout(r, 30)) // past the short settleMs: he is no longer busy
    await sessions.remoteControl(row.id)
    expect(sessions.summaryOf(row.id)?.remote).toBeTruthy()

    sessions.send(row.id, 'coucou')
    await tick()

    expect(sessions.summaryOf(row.id)?.remote).toBeFalsy() // taken back: the remote was stopped
    expect(sent.at(-1)).toBe('coucou') // and delivered, not stuck in the queue forever
  })

  it('autonomy takes him back from remote control instead of refusing', async () => {
    fakeRemote()
    vi.mocked(query).mock.results[0]!.value.push(resultMessage())
    await tick()
    await new Promise((r) => setTimeout(r, 30))
    await sessions.remoteControl(row.id)

    await sessions.autonomy(row.id, { mode: 'goal', text: 'continue' })
    await tick()

    expect(sessions.summaryOf(row.id)?.remote).toBeFalsy()
    expect(sent.at(-1)).toBe('/goal continue')
  })
})
