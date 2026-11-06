import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MonasteryEvent } from '@sangha/shared'
import { Normalizer, nextCronFire, summarizeInput } from '../src/normalize'

function replay(name: string): MonasteryEvent[] {
  const n = new Normalizer()
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((m) => !m.type.startsWith('__'))
    .flatMap((m) => n.push(m))
}

describe('Normalizer on a real two-monk session', () => {
  const events = replay('parallel-monks.jsonl')
  const of = <T extends MonasteryEvent['t']>(t: T) => events.filter((e): e is Extract<MonasteryEvent, { t: T }> => e.t === t)

  it('announces the session with the declared agents', () => {
    const started = of('session.started')[0]!
    expect(started.agents).toEqual(expect.arrayContaining(['reader', 'counter']))
    expect(started.claudeSessionId).toBeTruthy()
  })

  it('summons each monk once, keyed by the summoning tool_use id', () => {
    const summoned = of('monk.summoned')
    expect(summoned.map((s) => s.agentType).sort()).toEqual(['counter', 'reader'])
    expect(summoned.every((s) => s.monkId.startsWith('toolu_'))).toBe(true)
  })

  it('attributes monk tools and completion to the right monk', () => {
    const ids = new Map(of('monk.summoned').map((s) => [s.agentType, s.monkId]))
    const tools = of('monk.tool')
    expect(tools).toContainEqual(expect.objectContaining({ monkId: ids.get('reader'), tool: 'Read' }))
    expect(tools).toContainEqual(expect.objectContaining({ monkId: ids.get('counter'), tool: 'Bash' }))
    const done = of('monk.done')
    expect(done.map((d) => d.monkId).sort()).toEqual([...ids.values()].sort())
    expect(done.every((d) => d.status === 'completed')).toBe(true)
  })

  it('hides the summoning tool from Buddha but streams his words', () => {
    expect(of('buddha.tool').some((e) => e.tool === 'Agent' || e.tool === 'Task')).toBe(false)
    expect(of('buddha.delta').length).toBeGreaterThan(0)
    expect(of('buddha.text').length).toBeGreaterThan(0)
  })

  it('reports quota windows and turn cost', () => {
    const q = of('quota')[0]!.quota
    expect(q.fiveHour?.utilization).toBeGreaterThanOrEqual(0)
    expect(q.sevenDay?.resetsAt).toBeGreaterThan(0)
    expect(of('turn.done').length).toBeGreaterThanOrEqual(1)
  })
})

describe('errors', () => {
  it('turns an auth failure into an actionable error instead of Buddha speech', () => {
    const n = new Normalizer()
    const evs = n.push({
      type: 'assistant',
      error: 'authentication_failed',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    } as never)
    expect(evs).toEqual([{ t: 'error', message: expect.stringContaining('make token') }])
  })
})

describe('summarizeInput', () => {
  it('prefers meaningful keys and truncates', () => {
    expect(summarizeInput({ command: 'ls -la', timeout: 3 })).toBe('ls -la')
    expect(summarizeInput({ description: 'Count files', command: 'ls' })).toBe('Count files')
    expect(summarizeInput({ file_path: 'x'.repeat(300) }).length).toBe(140)
    expect(summarizeInput(null)).toBe('')
  })
})

describe('Normalizer.taskIdOfMonk', () => {
  it('maps a monk back to the SDK task id stopTask expects, distinct from his monkId (the summoning tool_use id)', () => {
    const n = new Normalizer()
    n.push({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_abc', task_type: 'local_agent', subagent_type: 'reader', description: 'd', prompt: 'p', spawn_depth: 1 } as never)
    expect(n.taskIdOfMonk('toolu_abc')).toBe('t1')
  })

  it('forgets the mapping once the task is done, so a stale id is never handed back', () => {
    const n = new Normalizer()
    n.push({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_abc', task_type: 'local_agent', subagent_type: 'reader', description: 'd', prompt: 'p', spawn_depth: 1 } as never)
    n.push({ type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'ok' } as never)
    expect(n.taskIdOfMonk('toolu_abc')).toBeUndefined()
  })
})

describe('Normalizer on background work', () => {
  it('reports the live background set, without ambient watchers', () => {
    const n = new Normalizer()
    const msg = {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'b1', task_type: 'local_bash', description: 'Run the e2e suite' },
        { task_id: 'w1', task_type: 'local_bash', description: 'watcher', ambient: true },
      ],
    }
    expect(n.push(msg as never)).toEqual([{ t: 'background', tasks: [{ id: 'b1', type: 'local_bash', description: 'Run the e2e suite' }] }])
  })
})

// His own /loop machinery: ScheduleWakeup (self-paced) or CronCreate/CronDelete (fixed interval), always as a
// tool_use block on the priest's own turn (parent_tool_use_id null) — this is what Store.lastAutonomy reads
// to know whether a loop keeps rescheduling itself or died.
describe('Normalizer on /loop tools (ScheduleWakeup, CronCreate, CronDelete)', () => {
  const tool = (name: string, input: unknown, parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', name, input }] },
  })

  it('ScheduleWakeup emits a loop.wake with nextAt from delaySeconds', () => {
    const n = new Normalizer()
    const before = Date.now()
    const evs = n.push(tool('ScheduleWakeup', { delaySeconds: 300, reason: 'check later', prompt: 'continue' }) as never)
    const wake = evs.find((e) => e.t === 'loop.wake')!
    expect(wake.stop).toBe(false)
    expect(wake.nextAt).toBeGreaterThanOrEqual(before + 300_000)
    expect(wake.nextAt).toBeLessThanOrEqual(Date.now() + 300_000)
  })

  it('ScheduleWakeup with stop:true ends the loop (stop true, no nextAt)', () => {
    const n = new Normalizer()
    const evs = n.push(tool('ScheduleWakeup', { stop: true }) as never)
    expect(evs.find((e) => e.t === 'loop.wake')).toEqual({ t: 'loop.wake', nextAt: null, stop: true })
  })

  it('CronCreate emits a loop.wake with the next fire computed from the cron expression', () => {
    const n = new Normalizer()
    const evs = n.push(tool('CronCreate', { cron: '*/5 * * * *', prompt: 'ping', recurring: true }) as never)
    const wake = evs.find((e) => e.t === 'loop.wake')!
    expect(wake.stop).toBe(false)
    expect(wake.nextAt).not.toBeNull()
    expect(wake.nextAt! % (5 * 60_000)).toBe(0) // lands exactly on a five-minute mark
  })

  it('CronDelete ends the loop (stop true, no nextAt)', () => {
    const n = new Normalizer()
    const evs = n.push(tool('CronDelete', { id: 'job1' }) as never)
    expect(evs.find((e) => e.t === 'loop.wake')).toEqual({ t: 'loop.wake', nextAt: null, stop: true })
  })

  it('still reports the plain buddha.tool event alongside loop.wake', () => {
    const n = new Normalizer()
    const evs = n.push(tool('ScheduleWakeup', { delaySeconds: 60, reason: 'soon' }) as never)
    expect(evs.some((e) => e.t === 'buddha.tool' && e.tool === 'ScheduleWakeup')).toBe(true)
  })

  it('a novice (parent set) calling these tools does not drive the priest’s own autonomy', () => {
    const n = new Normalizer()
    const evs = n.push(tool('ScheduleWakeup', { delaySeconds: 60 }, 'toolu_monk') as never)
    expect(evs.some((e) => e.t === 'loop.wake')).toBe(false)
    expect(evs.some((e) => e.t === 'monk.tool')).toBe(true)
  })
})

describe('nextCronFire', () => {
  it('finds the next five-minute mark after now, in local time', () => {
    const from = new Date(2026, 0, 1, 10, 2, 30).getTime()
    expect(nextCronFire('*/5 * * * *', from)).toBe(new Date(2026, 0, 1, 10, 5, 0, 0).getTime())
  })

  it('lands on the exact minute when already on a boundary, moving at least one minute ahead', () => {
    const from = new Date(2026, 0, 1, 10, 5, 0).getTime()
    expect(nextCronFire('*/5 * * * *', from)).toBe(new Date(2026, 0, 1, 10, 10, 0, 0).getTime())
  })

  it('returns null for an expression that is not a standard five-field cron', () => {
    expect(nextCronFire('not a cron', Date.now())).toBeNull()
  })
})

describe('Normalizer on MCP tool failures', () => {
  const toolUse = (id: string, name: string, parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', id, name, input: {} }] },
  })
  const toolResult = (toolUseId: string, isError: boolean, content: unknown = 'boom', parent: string | null = null) => ({
    type: 'user',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
  })

  it('reports an MCP tool failure on the main thread, with its server', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr') as never)
    const evs = n.push(toolResult('toolu_1', true, 'timeout') as never)
    expect(evs).toEqual([{ t: 'tool.error', tool: 'mcp__bitbucket__get_pr', server: 'bitbucket', message: 'timeout' }])
  })

  it('ignores a successful tool result', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr') as never)
    expect(n.push(toolResult('toolu_1', false) as never)).toEqual([])
  })

  it('ignores a non-MCP tool failure (Bash, Read…)', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'Bash') as never)
    expect(n.push(toolResult('toolu_1', true) as never)).toEqual([])
  })

  it('ignores a novice’s own tool failure (parent set)', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr', 'toolu_monk') as never)
    expect(n.push(toolResult('toolu_1', true, 'boom', 'toolu_monk') as never)).toEqual([])
  })
})
