import { describe, expect, it } from 'vitest'
import { isHandoff, nextDelay, parseAnswer, parseDelay } from '../src/shepherd'

const MIN = 60_000

describe('parseDelay', () => {
  it('reads minutes and hours', () => {
    expect(parseDelay('PLUS TARD 30 min')).toBe(30 * MIN)
    expect(parseDelay('plus tard 45 minutes')).toBe(45 * MIN)
    expect(parseDelay('PLUS TARD 2 h')).toBe(120 * MIN)
    expect(parseDelay('PLUS TARD 1h30')).toBe(90 * MIN)
    expect(parseDelay('dans 1,5 heures')).toBe(90 * MIN)
    expect(parseDelay('PLUS TARD une heure')).toBe(60 * MIN)
  })

  it('returns null when no delay is given', () => {
    expect(parseDelay('PLUS TARD')).toBeNull()
  })
})

describe('parseAnswer', () => {
  it('yes carries the handoff', () => {
    expect(parseAnswer('OUI\n\nPASSATION\nObjectif : X')).toEqual({ kind: 'yes', handoff: 'PASSATION\nObjectif : X' })
    expect(parseAnswer('**Oui.**\nPASSATION …').kind).toBe('yes')
  })

  it('only an outright refusal stops Buddha', () => {
    expect(parseAnswer('NON CATÉGORIQUE\nMigration en cours, contexte indispensable').kind).toBe('never')
    expect(parseAnswer('Non catégorique : ...').kind).toBe('never')
    const plainNo = parseAnswer('NON\npas maintenant')
    expect(plainNo).toMatchObject({ kind: 'later', delayMs: null })
  })

  it('later keeps his estimate', () => {
    expect(parseAnswer('PLUS TARD 20 min\nun sous-agent tourne encore')).toMatchObject({ kind: 'later', delayMs: 20 * MIN })
    expect(parseAnswer('Je termine la revue, plutôt dans 2 h.')).toMatchObject({ kind: 'later', delayMs: 120 * MIN })
  })
})

describe('nextDelay', () => {
  it('respects his estimate within bounds', () => {
    expect(nextDelay(0, 30 * MIN)).toBe(30 * MIN)
    expect(nextDelay(0, 1 * MIN)).toBe(5 * MIN)
    expect(nextDelay(0, 48 * 60 * MIN)).toBe(12 * 60 * MIN)
  })

  it('backs off when he gives no estimate, capped at 2 h', () => {
    expect(nextDelay(0, null)).toBe(10 * MIN)
    expect(nextDelay(2, null)).toBe(40 * MIN)
    expect(nextDelay(99, null)).toBe(120 * MIN)
  })
})

describe('isHandoff', () => {
  it('wants a PASSATION heading of its own', () => {
    expect(isHandoff('PASSATION\nObjectif : X')).toBe(true)
    expect(isHandoff('## Passation\n...')).toBe(true)
    expect(isHandoff('**PASSATION** :\n...')).toBe(true)
    expect(isHandoff("J'ai préparé la passation de l'acte chez le notaire.")).toBe(false)
  })
})
