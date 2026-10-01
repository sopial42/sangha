import { describe, expect, it } from 'vitest'
import { cleanScriptSummary, scriptPrompt, ScriptSummaries, trackScripts, type BackgroundTask } from '../src/scripts'

const task = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({ id: 'b1', type: 'local_bash', description: 'npm run test:e2e', ...over })

describe('trackScripts', () => {
  it('starts a new script at the time it is first seen', () => {
    const next = trackScripts([], [task()], 1000)
    expect(next).toEqual([{ id: 'b1', kind: 'local_bash', command: 'npm run test:e2e', summary: null, since: 1000 }])
  })

  it('keeps the original since across successive events for the same id', () => {
    const first = trackScripts([], [task()], 1000)
    const second = trackScripts(first, [task()], 5000)
    expect(second[0]!.since).toBe(1000)
  })

  it('excludes local_agent tasks: novices are shown separately', () => {
    const next = trackScripts([], [task({ id: 'a1', type: 'local_agent', description: 'Agent lecteur' })], 1000)
    expect(next).toEqual([])
  })

  it('drops a script no longer in the latest set (it finished)', () => {
    const first = trackScripts([], [task({ id: 'b1' }), task({ id: 'b2' })], 1000)
    const second = trackScripts(first, [task({ id: 'b1' })], 2000)
    expect(second.map((s) => s.id)).toEqual(['b1'])
  })

  it('carries over a summary already written for a script still running', () => {
    const first = trackScripts([], [task()], 1000)
    first[0]!.summary = 'Lance les tests e2e'
    const second = trackScripts(first, [task()], 2000)
    expect(second[0]!.summary).toBe('Lance les tests e2e')
  })

  it('orders scripts oldest first', () => {
    const first = trackScripts([], [task({ id: 'b1' })], 1000)
    const second = trackScripts(first, [task({ id: 'b1' }), task({ id: 'b2' })], 2000)
    expect(second.map((s) => s.id)).toEqual(['b1', 'b2'])
  })
})

describe('cleanScriptSummary', () => {
  it('trims surrounding quotes', () => {
    expect(cleanScriptSummary('"Lance les tests e2e"')).toBe('Lance les tests e2e')
    expect(cleanScriptSummary('«Lance les tests e2e»')).toBe('Lance les tests e2e')
  })

  it('collapses newlines and extra spaces into a single line', () => {
    expect(cleanScriptSummary('Lance   les tests\ne2e du  dossier')).toBe('Lance les tests e2e du dossier')
  })

  it('caps the sentence to 12 words', () => {
    const long = Array.from({ length: 20 }, (_, i) => `mot${i}`).join(' ')
    const cleaned = cleanScriptSummary(long)
    const words = cleaned.split(' ')
    expect(words.length).toBe(12)
    expect(words[11]).toBe('mot11…')
  })

  it('leaves a short, clean sentence untouched', () => {
    expect(cleanScriptSummary('Attend que la stack Docker locale démarre')).toBe('Attend que la stack Docker locale démarre')
  })
})

describe('scriptPrompt', () => {
  it('includes the session title and the command', () => {
    const p = scriptPrompt('npm run test:e2e', 'Corrige le panier')
    expect(p).toContain('npm run test:e2e')
    expect(p).toContain('Corrige le panier')
  })
})

describe('ScriptSummaries', () => {
  it('starts with nothing cached', () => {
    const s = new ScriptSummaries(
      () => {},
      async () => null,
    )
    expect(s.of('sess1', 'b1')).toBeNull()
  })

  it('fills the cache from a summarize call and reports it ready', async () => {
    const ready: [string, string, string][] = []
    const s = new ScriptSummaries(
      (sessionId, taskId, summary) => ready.push([sessionId, taskId, summary]),
      async () => 'Lance les tests e2e',
    )
    s.request('sess1', 'b1', 'npm run test:e2e', 'Corrige le panier')
    await s.drained()
    expect(s.of('sess1', 'b1')).toBe('Lance les tests e2e')
    expect(ready).toEqual([['sess1', 'b1', 'Lance les tests e2e']])
  })

  it('does not call summarize twice for the same session/task once requested', async () => {
    let calls = 0
    const s = new ScriptSummaries(
      () => {},
      async () => {
        calls++
        return 'x'
      },
    )
    s.request('sess1', 'b1', 'cmd', 'title')
    s.request('sess1', 'b1', 'cmd', 'title')
    await s.drained()
    expect(calls).toBe(1)
  })

  it('keeps a null result from a failed call without retrying on its own', async () => {
    let calls = 0
    const s = new ScriptSummaries(
      () => {},
      async () => {
        calls++
        return null
      },
    )
    s.request('sess1', 'b1', 'cmd', 'title')
    await s.drained()
    expect(s.of('sess1', 'b1')).toBeNull()
    s.request('sess1', 'b1', 'cmd', 'title')
    await s.drained()
    expect(calls).toBe(1)
  })

  it('runs several summaries one at a time, never concurrently', async () => {
    let running = 0
    let concurrent = false
    const s = new ScriptSummaries(
      () => {},
      async () => {
        running++
        if (running > 1) concurrent = true
        await new Promise((r) => setTimeout(r, 5))
        running--
        return 'x'
      },
    )
    s.request('sess1', 'b1', 'cmd', 'title')
    s.request('sess1', 'b2', 'cmd', 'title')
    s.request('sess2', 'b1', 'cmd', 'title')
    await s.drained()
    expect(concurrent).toBe(false)
  })
})
