import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MonasteryEvent } from '@sangha/shared'
import { Normalizer, summarizeInput } from '../src/normalize'

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
