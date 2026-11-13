import { describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildClosedSearchPrompt, searchClosed, parseClosedSearchResult, type ClosedSearchEntry } from '../src/recap'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const entry = (over: Partial<ClosedSearchEntry> = {}): ClosedSearchEntry => ({
  id: 'p1',
  date: '2026-03-07',
  project: 'robia',
  branch: 'sangha/x',
  agent: 'claude',
  note: 'RIB ET MAIL',
  title: 'fixing the cart',
  summary: 'Fixed the cart total.',
  ...over,
})

describe('buildClosedSearchPrompt', () => {
  it('writes one compact line per entry, then the question', () => {
    const prompt = buildClosedSearchPrompt([entry()], 'the cart?')
    expect(prompt).toContain('id=p1')
    expect(prompt).toContain('date=2026-03-07')
    expect(prompt).toContain('project=robia')
    expect(prompt).toContain('branch=sangha/x')
    expect(prompt).toContain('agent=claude')
    expect(prompt).toContain('note=RIB ET MAIL')
    expect(prompt).toContain('title=fixing the cart')
    expect(prompt).toContain('summary=Fixed the cart total.')
    expect(prompt).toContain('QUESTION: the cart?')
  })

  it('marks a missing note or summary rather than leaving it blank', () => {
    const prompt = buildClosedSearchPrompt([entry({ note: null, summary: null, branch: null })], 'x')
    expect(prompt).toContain('note=-')
    expect(prompt).toContain('summary=-')
    expect(prompt).toContain('branch=-')
  })

  it('puts entries ahead of the question, so a truncation from the tail never loses it', () => {
    const prompt = buildClosedSearchPrompt([entry()], 'x')
    expect(prompt.indexOf('id=p1')).toBeLessThan(prompt.indexOf('QUESTION'))
  })
})

describe('parseClosedSearchResult', () => {
  it('keeps results whose id is known, in the order given', () => {
    const raw = { results: [{ id: 'a', reason: 'a reason' }, { id: 'b', reason: 'another one' }] }
    expect(parseClosedSearchResult(raw, new Set(['a', 'b']))).toEqual({ results: [{ id: 'a', reason: 'a reason' }, { id: 'b', reason: 'another one' }] })
  })

  it('drops results whose id is not among the known ones', () => {
    const raw = { results: [{ id: 'a', reason: 'ok' }, { id: 'ghost', reason: 'made up' }] }
    expect(parseClosedSearchResult(raw, new Set(['a']))).toEqual({ results: [{ id: 'a', reason: 'ok' }] })
  })

  it('drops malformed entries (missing or wrong-typed id/reason)', () => {
    const raw = { results: [{ id: 'a', reason: 'ok' }, { id: 'b' }, { reason: 'no id' }, null, 'x'] }
    expect(parseClosedSearchResult(raw, new Set(['a', 'b']))).toEqual({ results: [{ id: 'a', reason: 'ok' }] })
  })

  it('caps at 15 results', () => {
    const raw = { results: Array.from({ length: 20 }, (_, i) => ({ id: `id${i}`, reason: 'r' })) }
    const ids = new Set(Array.from({ length: 20 }, (_, i) => `id${i}`))
    expect(parseClosedSearchResult(raw, ids).results).toHaveLength(15)
  })

  it('is an empty result for anything that is not a well-shaped object', () => {
    expect(parseClosedSearchResult(null, new Set())).toEqual({ results: [] })
    expect(parseClosedSearchResult({}, new Set())).toEqual({ results: [] })
    expect(parseClosedSearchResult({ results: 'nope' }, new Set())).toEqual({ results: [] })
  })
})

/** A one-shot structured-output `result` message, as recap.ts's `ask` reads it. */
const resultMessage = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output })

describe('searchClosed', () => {
  it('asks the model and filters its answer against the entries given', async () => {
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ results: [{ id: 'p1', reason: 'fixed the cart' }, { id: 'ghost', reason: 'should not show up' }] })
      },
    } as never)
    const out = await searchClosed([entry({ id: 'p1' })], 'who touched the cart?')
    expect(out).toEqual({ results: [{ id: 'p1', reason: 'fixed the cart' }] })
  })

  it('is an empty result when the model gives nothing back', async () => {
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () {} } as never)
    expect(await searchClosed([entry()], 'x')).toEqual({ results: [] })
  })
})
