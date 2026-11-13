import { beforeEach, describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelChoice, SessionSummary } from '@sangha/shared'
import { DEFAULT_ADVISOR_SETTINGS, Advisor, advisorBackoffMs, mergeAdvisorSettings, nextVoteStatus } from '../src/advisor'
import { Store, type SessionRow } from '../src/db'
import type { Providers } from '../src/providers'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const resultMessage = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 50 }, result: 'ok' })
const CHOICE: ModelChoice = { id: 'sonnet', label: 'Claude Sonnet', engine: 'claude', model: 'sonnet' }
const fakeProviders = { choice: vi.fn().mockResolvedValue(CHOICE), env: vi.fn().mockReturnValue({}) } as unknown as Providers
const noSessions = (): SessionSummary[] => []

const row = (id: string): SessionRow => ({ id, project: 'p', agent: 'lead', title: 't', createdAt: 1, claudeSessionId: null, branch: null, worktree: null, baseSha: null, archivedAt: null, lastSeenSeq: 0 })

beforeEach(() => {
  vi.mocked(query).mockClear()
  vi.mocked(fakeProviders.choice).mockClear()
})

describe('mergeAdvisorSettings', () => {
  it('merges nested levels/weekly patches onto the current settings', () => {
    const next = mergeAdvisorSettings(DEFAULT_ADVISOR_SETTINGS, { levels: { project: true }, weekly: { maxWeekUsedPct: 30 } })
    expect(next.levels).toEqual({ manual: true, sangha: true, project: true })
    expect(next.weekly).toEqual({ day: 4, at: '12:00', maxWeekUsedPct: 30 })
  })

  it('rejects a malformed time, an out-of-range weekly day or threshold, and a tiny context cap', () => {
    expect(() => mergeAdvisorSettings(DEFAULT_ADVISOR_SETTINGS, { dailyAt: '8:00' })).toThrow()
    expect(() => mergeAdvisorSettings(DEFAULT_ADVISOR_SETTINGS, { weekly: { day: 7 } })).toThrow()
    expect(() => mergeAdvisorSettings(DEFAULT_ADVISOR_SETTINGS, { weekly: { maxWeekUsedPct: 150 } })).toThrow()
    expect(() => mergeAdvisorSettings(DEFAULT_ADVISOR_SETTINGS, { maxInputChars: 10 })).toThrow()
  })
})

describe('nextVoteStatus', () => {
  it('cycles proposed -> accepted -> proposed on repeated 👍, and rejects on 👎', () => {
    expect(nextVoteStatus('proposed', 'up')).toBe('accepted')
    expect(nextVoteStatus('accepted', 'up')).toBe('proposed')
    expect(nextVoteStatus('proposed', 'down')).toBe('rejected')
    expect(nextVoteStatus('rejected', 'down')).toBe('proposed')
  })
})

describe('Advisor.runPass', () => {
  it('writes a report and topics from a successful model answer, and marks feedback processed', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'too verbose', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ report: 'One topic worth keeping.', topics: [{ scope: 'manual', title: 'Too verbose', detail: 'Several feedback items say so', evidence: ['f1'] }] })
      },
    } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.runPass('manual')
    const state = advisor.state()
    expect(state.reports[0]!.text).toBe('One topic worth keeping.')
    expect(state.topics).toHaveLength(1)
    expect(state.topics[0]!.status).toBe('proposed')
    expect(store.pendingFeedback()).toEqual([])
    expect(state.lastError).toBeNull()
  })

  it('marks nothing processed and records the error when the model answer is invalid', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.runPass('manual')
    expect(store.pendingFeedback()).toHaveLength(1)
    expect(advisor.state().lastError).toBeTruthy()
  })

  it('does not call the model when there is nothing new and the pass is not manual', async () => {
    const store = new Store(':memory:')
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true })
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.runPass('weekly')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses two passes at once (in-memory lock)', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true })
    let release!: () => void
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        await new Promise<void>((r) => (release = r))
        yield resultMessage({ report: 'r', topics: [] })
      },
    } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    const first = advisor.runPass('manual')
    const second = advisor.runPass('manual')
    await Promise.resolve() // let `providers.choice()` resolve, until the generator waits on `release`
    release()
    await Promise.all([first, second])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('advances lastRunAt on a manual pass, but not on a conversation pass', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'up', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ report: 'r', topics: [] }) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.runPass('conversation', 'a')
    expect(advisor.settings().lastRunAt).toBeNull()
    await advisor.runPass('manual')
    expect(advisor.settings().lastRunAt).not.toBeNull()
  })
})

describe('Advisor.voteTopic / doneTopic', () => {
  it('👍 accepts a proposed topic, 👍 again un-votes it back to proposed', () => {
    const store = new Store(':memory:')
    store.upsertAdvisorTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    expect(advisor.voteTopic('t1', 'up').status).toBe('accepted')
    expect(advisor.voteTopic('t1', 'up').status).toBe('proposed')
  })

  it('refuses to mark done a topic that is not accepted', () => {
    const store = new Store(':memory:')
    store.upsertAdvisorTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    expect(() => advisor.doneTopic('t1')).toThrow()
  })

  it('marks an accepted topic done', () => {
    const store = new Store(':memory:')
    store.upsertAdvisorTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'accepted', createdAt: 1, updatedAt: 1 })
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    expect(advisor.doneTopic('t1').status).toBe('done')
  })
})

describe('Advisor.addFeedback', () => {
  it('freezes an excerpt and stores it pending', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.append('a', { t: 'assistant.text', text: 'hello' })
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    const f = advisor.addFeedback({ sessionId: 'a', rating: 'up' })
    expect(f.excerpt).toContain('hello')
    expect(store.pendingFeedback()).toHaveLength(1)
  })

  it('rejects a rating that is neither up nor down', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    expect(() => advisor.addFeedback({ sessionId: 'a', rating: 'maybe' as never })).toThrow()
    expect(store.pendingFeedback()).toEqual([])
  })
})

describe('advisorBackoffMs', () => {
  it('escalates 1h, 2h, 4h, capped at 6h for further consecutive failures', () => {
    expect(advisorBackoffMs(1)).toBe(3600_000)
    expect(advisorBackoffMs(2)).toBe(2 * 3600_000)
    expect(advisorBackoffMs(3)).toBe(4 * 3600_000)
    expect(advisorBackoffMs(4)).toBe(6 * 3600_000)
    expect(advisorBackoffMs(10)).toBe(6 * 3600_000)
  })
})

describe('Advisor.tick: backoff after a failed scheduled pass (cost loop fix)', () => {
  it('does not retry a scheduled pass again until the backoff window has passed', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true, model: 'ovh::llama-4', dailyAt: '00:00' })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.tick()
    expect(query).toHaveBeenCalledTimes(1)
    await advisor.tick()
    expect(query).toHaveBeenCalledTimes(1) // still inside the backoff: no new call, no new cost
  })

  it('"run now" ignores the backoff and still calls the model', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true, model: 'ovh::llama-4', dailyAt: '00:00' })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.tick() // fails, arms the backoff
    expect(query).toHaveBeenCalledTimes(1)
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ report: 'r', topics: [] }) } } as never)
    await advisor.runPass('manual')
    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('Advisor.tick: a session’s conversation pass stops retrying after 3 consecutive failures', () => {
  it('leaves its feedback pending for the next scheduled pass instead of retrying forever', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.archive('a')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('advisor', { ...DEFAULT_ADVISOR_SETTINGS, enabled: true, model: 'ovh::llama-4', lastRunAt: Date.now() })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await advisor.tick()
    await advisor.tick()
    await advisor.tick()
    expect(query).toHaveBeenCalledTimes(3)
    await advisor.tick()
    expect(query).toHaveBeenCalledTimes(3) // the 4th attempt is blocked: 3 failures in a row for this session
    expect(store.pendingFeedback()).toHaveLength(1) // its feedback stays pending for the next daily or weekly pass
  })
})

describe('Advisor.ask', () => {
  it('records the question and the reply in chat on a successful, non-empty answer', async () => {
    const store = new Store(':memory:')
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage(undefined) } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    const out = await advisor.ask('A question?')
    expect(out.reply).toBe('ok')
    expect(store.advisorChat().map((t) => t.text)).toEqual(['A question?', 'ok'])
  })

  it('records nothing and throws a readable error when the model fails to answer', async () => {
    const store = new Store(':memory:')
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield { type: 'result', subtype: 'error_max_turns', result: '' } } } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await expect(advisor.ask('A question?')).rejects.toThrow(/The Advisor could not answer/)
    expect(store.advisorChat()).toEqual([])
  })

  it('records nothing and throws a readable error when the query itself throws', async () => {
    const store = new Store(':memory:')
    vi.mocked(query).mockReturnValue({
      // eslint-disable-next-line require-yield -- a stream that fails before its first message
      [Symbol.asyncIterator]: async function* () {
        throw new Error('network down')
      },
    } as never)
    const advisor = new Advisor(store, fakeProviders, noSessions, () => null)
    await expect(advisor.ask('A question?')).rejects.toThrow(/The Advisor could not answer/)
    expect(store.advisorChat()).toEqual([])
  })
})
