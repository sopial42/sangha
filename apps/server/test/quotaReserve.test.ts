import { describe, expect, it } from 'vitest'
import type { Quota, QuotaReserve } from '@sangha/shared'
import { DEFAULT_RESERVE, QuotaReserveSetting, reserveState } from '../src/quotaReserve'

const NOW = 1_000_000 // epoch seconds, arbitrary but fixed

const quota = (fiveHour: number | null, fiveHourResetsAt: number | null = null, sevenDay: number | null = null, sevenDayResetsAt: number | null = null): Quota => ({
  status: 'allowed',
  fiveHour: fiveHour === null ? null : { utilization: fiveHour, resetsAt: fiveHourResetsAt },
  sevenDay: sevenDay === null ? null : { utilization: sevenDay, resetsAt: sevenDayResetsAt },
})

describe('reserveState', () => {
  it('is reached once a counted window crosses 100 - pct %', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    expect(reserveState(reserve, quota(0.89), NOW).reached).toBe(false)
    expect(reserveState(reserve, quota(0.9), NOW).reached).toBe(true)
    expect(reserveState(reserve, quota(0.9), NOW).window).toBe('fiveHour')
  })

  it('never bites while disabled, whatever the usage', () => {
    const reserve: QuotaReserve = { enabled: false, pct: 10 }
    const state = reserveState(reserve, quota(1), NOW)
    expect(state.reached).toBe(false)
    expect(state.window).toBeNull()
  })

  it('ignores a window whose resetsAt has already passed (it just started afresh)', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    // Five-hour window reports 95% but its reset time is behind us: a fresh window is about to replace it.
    const state = reserveState(reserve, quota(0.95, NOW - 10), NOW)
    expect(state.reached).toBe(false)
    expect(state.window).toBeNull()
  })

  it('still counts a window whose resetsAt is null or still ahead', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    expect(reserveState(reserve, quota(0.95, null), NOW).reached).toBe(true)
    expect(reserveState(reserve, quota(0.95, NOW + 10), NOW).reached).toBe(true)
  })

  it('names the costlier window as binding when both cross the threshold', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    const state = reserveState(reserve, quota(0.92, NOW + 1000, 0.97, NOW + 1000), NOW)
    expect(state.reached).toBe(true)
    expect(state.window).toBe('sevenDay')
  })

  it('leaves window null when nothing is reached', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    const state = reserveState(reserve, quota(0.5, null, 0.4, null), NOW)
    expect(state.reached).toBe(false)
    expect(state.window).toBeNull()
  })

  it('copes with no quota known yet', () => {
    const reserve: QuotaReserve = { enabled: true, pct: 10 }
    const state = reserveState(reserve, null, NOW)
    expect(state.reached).toBe(false)
    expect(state.window).toBeNull()
  })
})

describe('QuotaReserveSetting', () => {
  it('defaults to a 10% reserve, enabled, until something is stored', () => {
    const s = new QuotaReserveSetting(() => null, () => undefined)
    expect(s.get()).toEqual(DEFAULT_RESERVE)
  })

  it('merges a partial change onto the current reserve and persists it', () => {
    let stored: QuotaReserve | null = { enabled: true, pct: 10 }
    const s = new QuotaReserveSetting(() => stored, (v) => (stored = v))
    expect(s.set({ pct: 20 })).toEqual({ enabled: true, pct: 20 })
    expect(stored).toEqual({ enabled: true, pct: 20 })
    expect(s.set({ enabled: false })).toEqual({ enabled: false, pct: 20 })
  })

  it('refuses a non-integer or out-of-range pct, and a non-boolean enabled', () => {
    const s = new QuotaReserveSetting(() => null, () => undefined)
    expect(() => s.set({ pct: 51 })).toThrow()
    expect(() => s.set({ pct: -1 })).toThrow()
    expect(() => s.set({ pct: 5.5 })).toThrow()
    expect(() => s.set({ enabled: 'yes' as unknown as boolean })).toThrow()
  })

  it('accepts the edges: 0 and 50', () => {
    const s = new QuotaReserveSetting(() => null, () => undefined)
    expect(s.set({ pct: 0 }).pct).toBe(0)
    expect(s.set({ pct: 50 }).pct).toBe(50)
  })
})
