import { describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildNirvanaSearchPrompt, nirvanaSearch, parseNirvanaSearchResult, type NirvanaSearchEntry } from '../src/recap'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const entry = (over: Partial<NirvanaSearchEntry> = {}): NirvanaSearchEntry => ({
  id: 'p1',
  date: '2026-03-07',
  project: 'robia',
  branch: 'sangha/x',
  agent: 'claude',
  note: 'RIB ET MAIL',
  title: 'je corrige le panier',
  summary: 'A corrigé le calcul du panier.',
  ...over,
})

describe('buildNirvanaSearchPrompt', () => {
  it('writes one compact line per entry, then the question', () => {
    const prompt = buildNirvanaSearchPrompt([entry()], 'le panier ?')
    expect(prompt).toContain('id=p1')
    expect(prompt).toContain('date=2026-03-07')
    expect(prompt).toContain('project=robia')
    expect(prompt).toContain('branch=sangha/x')
    expect(prompt).toContain('agent=claude')
    expect(prompt).toContain('note=RIB ET MAIL')
    expect(prompt).toContain('title=je corrige le panier')
    expect(prompt).toContain('summary=A corrigé le calcul du panier.')
    expect(prompt).toContain('QUESTION: le panier ?')
  })

  it('marks a missing note or summary rather than leaving it blank', () => {
    const prompt = buildNirvanaSearchPrompt([entry({ note: null, summary: null, branch: null })], 'x')
    expect(prompt).toContain('note=-')
    expect(prompt).toContain('summary=-')
    expect(prompt).toContain('branch=-')
  })

  it('puts entries ahead of the question, so a truncation from the tail never loses it', () => {
    const prompt = buildNirvanaSearchPrompt([entry()], 'x')
    expect(prompt.indexOf('id=p1')).toBeLessThan(prompt.indexOf('QUESTION'))
  })
})

describe('parseNirvanaSearchResult', () => {
  it('keeps results whose id is known, in the order given', () => {
    const raw = { results: [{ id: 'a', reason: 'une raison' }, { id: 'b', reason: 'une autre' }] }
    expect(parseNirvanaSearchResult(raw, new Set(['a', 'b']))).toEqual({ results: [{ id: 'a', reason: 'une raison' }, { id: 'b', reason: 'une autre' }] })
  })

  it('drops results whose id is not among the known ones', () => {
    const raw = { results: [{ id: 'a', reason: 'ok' }, { id: 'ghost', reason: 'inventé' }] }
    expect(parseNirvanaSearchResult(raw, new Set(['a']))).toEqual({ results: [{ id: 'a', reason: 'ok' }] })
  })

  it('drops malformed entries (missing or wrong-typed id/reason)', () => {
    const raw = { results: [{ id: 'a', reason: 'ok' }, { id: 'b' }, { reason: 'sans id' }, null, 'x'] }
    expect(parseNirvanaSearchResult(raw, new Set(['a', 'b']))).toEqual({ results: [{ id: 'a', reason: 'ok' }] })
  })

  it('caps at 15 results', () => {
    const raw = { results: Array.from({ length: 20 }, (_, i) => ({ id: `id${i}`, reason: 'r' })) }
    const ids = new Set(Array.from({ length: 20 }, (_, i) => `id${i}`))
    expect(parseNirvanaSearchResult(raw, ids).results).toHaveLength(15)
  })

  it('is an empty result for anything that is not a well-shaped object', () => {
    expect(parseNirvanaSearchResult(null, new Set())).toEqual({ results: [] })
    expect(parseNirvanaSearchResult({}, new Set())).toEqual({ results: [] })
    expect(parseNirvanaSearchResult({ results: 'nope' }, new Set())).toEqual({ results: [] })
  })
})

/** A one-shot structured-output `result` message, as recap.ts's `ask` reads it. */
const resultMessage = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output })

describe('nirvanaSearch', () => {
  it('asks the model and filters its answer against the entries given', async () => {
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ results: [{ id: 'p1', reason: 'corrige le panier' }, { id: 'ghost', reason: 'ne devrait pas apparaître' }] })
      },
    } as never)
    const out = await nirvanaSearch([entry({ id: 'p1' })], 'qui a touché au panier ?')
    expect(out).toEqual({ results: [{ id: 'p1', reason: 'corrige le panier' }] })
  })

  it('is an empty result when the model gives nothing back', async () => {
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () {} } as never)
    expect(await nirvanaSearch([entry()], 'x')).toEqual({ results: [] })
  })
})
