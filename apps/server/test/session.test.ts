import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { BUDDHA_SESSION_ID } from '@sangha/shared'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { LOOP_STOP_MESSAGE, Store, type SessionRow } from '../src/db'
import { QuotaReserveSetting } from '../src/quotaReserve'
import { Sessions, UserError } from '../src/session'
import type { Projects } from '../src/projects'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

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
    void (async () => {
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) sent.push(m.message.content as string)
    })()
    const fake = {
      [Symbol.asyncIterator]: async function* () {
        for (;;) {
          if (outbox.length) yield outbox.shift()
          else await new Promise<void>((r) => (wake = r))
        }
      },
      interrupt: vi.fn().mockResolvedValue(undefined),
      stopTask: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
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
