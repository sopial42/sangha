import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusySettle } from '../src/settle'

describe('BusySettle', () => {
  let changes: boolean[]
  let settle: BusySettle

  beforeEach(() => {
    vi.useFakeTimers()
    changes = []
    settle = new BusySettle(5_000, (busy) => changes.push(busy))
  })

  afterEach(() => vi.useRealTimers())

  it('says he works at once', () => {
    settle.set(true)
    expect(changes).toEqual([true])
  })

  it('says he stopped only once he stayed still for the whole delay', () => {
    settle.set(true)
    settle.set(false)
    vi.advanceTimersByTime(4_999)
    expect(changes).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true, false])
  })

  it('a wake-up within the delay (a background task reporting back) is no stop at all', () => {
    settle.set(true)
    settle.set(false)
    vi.advanceTimersByTime(3_500)
    settle.set(true)
    vi.advanceTimersByTime(10_000)
    expect(changes).toEqual([true])
    settle.set(false)
    vi.advanceTimersByTime(5_000)
    expect(changes).toEqual([true, false])
  })

  it('says nothing when nothing changes', () => {
    settle.set(false)
    vi.advanceTimersByTime(10_000)
    settle.set(true)
    settle.set(true)
    expect(changes).toEqual([true])
  })

  it('a stop for good (the session closed) is told at once', () => {
    settle.set(true)
    settle.set(false, { now: true })
    expect(changes).toEqual([true, false])
    vi.advanceTimersByTime(10_000)
    expect(changes).toEqual([true, false])
  })

  it('knows whether he stopped, settled or not', () => {
    settle.set(true)
    settle.set(false)
    expect(settle.busy).toBe(true)
    expect(settle.still).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(settle.busy).toBe(false)
  })
})
