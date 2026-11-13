import { describe, expect, it } from 'vitest'
import { isHandoff, nextDelay, parseAnswer, parseDelay, readDecision } from '../src/shepherd'

const MIN = 60_000

describe('parseDelay', () => {
  it('reads minutes and hours', () => {
    expect(parseDelay('LATER 30 min')).toBe(30 * MIN)
    expect(parseDelay('later 45 minutes')).toBe(45 * MIN)
    expect(parseDelay('LATER 2 h')).toBe(120 * MIN)
    expect(parseDelay('LATER 1h30')).toBe(90 * MIN)
    expect(parseDelay('in 1.5 hours')).toBe(90 * MIN)
    expect(parseDelay('LATER an hour')).toBe(60 * MIN)
  })

  it('still reads French delays from older sessions', () => {
    expect(parseDelay('PLUS TARD 30 min')).toBe(30 * MIN)
    expect(parseDelay('dans 1,5 heures')).toBe(90 * MIN)
    expect(parseDelay('PLUS TARD une heure')).toBe(60 * MIN)
  })

  it('returns null when no delay is given', () => {
    expect(parseDelay('LATER')).toBeNull()
  })
})

describe('parseAnswer', () => {
  it('yes carries the hand-off', () => {
    expect(parseAnswer('YES\n\nHANDOFF\nGoal: X')).toEqual({ kind: 'yes', handoff: 'HANDOFF\nGoal: X' })
    expect(parseAnswer('**Yes.**\nHANDOFF …').kind).toBe('yes')
    expect(parseAnswer('OUI\n\nPASSATION\nObjectif : X').kind).toBe('yes')
  })

  it('only an outright refusal stops the orchestrator', () => {
    expect(parseAnswer('NEVER\nMigration in progress, the context is essential').kind).toBe('never')
    expect(parseAnswer('Never: ...').kind).toBe('never')
    expect(parseAnswer('NON CATÉGORIQUE\nMigration en cours').kind).toBe('never')
    const plainNo = parseAnswer('NO\nnot now')
    expect(plainNo).toMatchObject({ kind: 'later', delayMs: null })
  })

  it('later keeps its estimate', () => {
    expect(parseAnswer('LATER 20 min\na subagent is still running')).toMatchObject({ kind: 'later', delayMs: 20 * MIN })
    expect(parseAnswer('I am finishing the review, more like in 2 h.')).toMatchObject({ kind: 'later', delayMs: 120 * MIN })
  })
})

describe('nextDelay', () => {
  it('respects its estimate within bounds', () => {
    expect(nextDelay(0, 30 * MIN)).toBe(30 * MIN)
    expect(nextDelay(0, 1 * MIN)).toBe(5 * MIN)
    expect(nextDelay(0, 48 * 60 * MIN)).toBe(12 * 60 * MIN)
  })

  it('backs off when it gives no estimate, capped at 2 h', () => {
    expect(nextDelay(0, null)).toBe(10 * MIN)
    expect(nextDelay(2, null)).toBe(40 * MIN)
    expect(nextDelay(99, null)).toBe(120 * MIN)
  })
})

describe('isHandoff', () => {
  it('wants a HANDOFF heading of its own', () => {
    expect(isHandoff('HANDOFF\nGoal: X')).toBe(true)
    expect(isHandoff('## Hand-off\n...')).toBe(true)
    expect(isHandoff('**HANDOFF** :\n...')).toBe(true)
    expect(isHandoff('PASSATION\nObjectif : X')).toBe(true)
    expect(isHandoff('I prepared the handoff of the deed at the notary.')).toBe(false)
  })
})

describe('readDecision', () => {
  it('finds the answer after what it said first', () => {
    const a = readDecision(['Before answering, I check the decisions are written down.', 'I add the study to the repo.', 'YES\n\nI stopped my loop.\n\nHANDOFF\nGoal: X'])
    expect(a.kind).toBe('yes')
    expect(a.kind === 'yes' && a.handoff).toContain('HANDOFF')
  })

  it('keeps a hand-off written over several messages', () => {
    const a = readDecision(['YES', 'HANDOFF\nGoal: X'])
    expect(a).toEqual({ kind: 'yes', handoff: 'HANDOFF\nGoal: X' })
  })

  it('without a decision word, it is not a yes', () => {
    expect(readDecision(['I am still looking at one point.']).kind).toBe('later')
  })
})
