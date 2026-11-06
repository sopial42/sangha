import { beforeEach, describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelChoice, SessionSummary } from '@sangha/shared'
import { DEFAULT_ELDER_SETTINGS, Elder, mergeElderSettings, nextVoteStatus } from '../src/elder'
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

describe('mergeElderSettings', () => {
  it('merges nested levels/weekly patches onto the current settings', () => {
    const next = mergeElderSettings(DEFAULT_ELDER_SETTINGS, { levels: { project: true }, weekly: { maxWeekUsedPct: 30 } })
    expect(next.levels).toEqual({ manual: true, sangha: true, project: true })
    expect(next.weekly).toEqual({ day: 4, at: '12:00', maxWeekUsedPct: 30 })
  })

  it('rejects a malformed time, an out-of-range weekly day or threshold, and a tiny context cap', () => {
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { dailyAt: '8:00' })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { weekly: { day: 7 } })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { weekly: { maxWeekUsedPct: 150 } })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { maxInputChars: 10 })).toThrow()
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

describe('Elder.runPass', () => {
  it('writes a report and topics from a successful model answer, and marks feedback processed', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'trop verbeux', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ report: 'Un sujet à retenir.', topics: [{ scope: 'manual', title: 'Trop verbeux', detail: 'Plusieurs retours le disent', evidence: ['f1'] }] })
      },
    } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('manual')
    const state = elder.state()
    expect(state.reports[0]!.text).toBe('Un sujet à retenir.')
    expect(state.topics).toHaveLength(1)
    expect(state.topics[0]!.status).toBe('proposed')
    expect(store.pendingFeedback()).toEqual([])
    expect(state.lastError).toBeNull()
  })

  it('marks nothing processed and records the error when the model answer is invalid', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('manual')
    expect(store.pendingFeedback()).toHaveLength(1)
    expect(elder.state().lastError).toBeTruthy()
  })

  it('does not call the model when there is nothing new and the pass is not manual', async () => {
    const store = new Store(':memory:')
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('weekly')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses two passes at once (in-memory lock)', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    let release!: () => void
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        await new Promise<void>((r) => (release = r))
        yield resultMessage({ report: 'r', topics: [] })
      },
    } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    const first = elder.runPass('manual')
    const second = elder.runPass('manual')
    await Promise.resolve() // laisse `providers.choice()` se résoudre, jusqu'à ce que le générateur attende `release`
    release()
    await Promise.all([first, second])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('advances lastRunAt on a manual pass, but not on a conversation pass', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'up', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ report: 'r', topics: [] }) } } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('conversation', 'a')
    expect(elder.settings().lastRunAt).toBeNull()
    await elder.runPass('manual')
    expect(elder.settings().lastRunAt).not.toBeNull()
  })
})

describe('Elder.voteTopic / doneTopic', () => {
  it('👍 accepts a proposed topic, 👍 again un-votes it back to proposed', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(elder.voteTopic('t1', 'up').status).toBe('accepted')
    expect(elder.voteTopic('t1', 'up').status).toBe('proposed')
  })

  it('refuses to mark done a topic that is not accepted', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(() => elder.doneTopic('t1')).toThrow()
  })

  it('marks an accepted topic done', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'accepted', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(elder.doneTopic('t1').status).toBe('done')
  })
})

describe('Elder.addFeedback', () => {
  it('freezes an excerpt and stores it pending', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.append('a', { t: 'buddha.text', text: 'bonjour' })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    const f = elder.addFeedback({ sessionId: 'a', rating: 'up' })
    expect(f.excerpt).toContain('bonjour')
    expect(store.pendingFeedback()).toHaveLength(1)
  })
})
