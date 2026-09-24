import { describe, expect, it } from 'vitest'
import { buildCostReport, type CostSession } from '../src/cost'

const localMonthTs = (month: string, day: number) => new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00`).getTime()

const session = (over: Partial<CostSession>): CostSession => ({
  id: 's1',
  project: 'robia',
  title: 'Do it',
  createdAt: localMonthTs('2026-09', 1),
  cost: 1,
  ...over,
})

describe('buildCostReport', () => {
  it('reports nothing for an empty history', () => {
    expect(buildCostReport([])).toEqual({ total: 0, sessions: 0, since: null, months: [] })
  })

  it('buckets sessions by the local month of their creation', () => {
    const report = buildCostReport([
      session({ id: 'a', createdAt: localMonthTs('2026-08', 15), cost: 1 }),
      session({ id: 'b', createdAt: localMonthTs('2026-09', 1), cost: 2 }),
      session({ id: 'c', createdAt: localMonthTs('2026-09', 20), cost: 3 }),
    ])
    expect(report.months.map((m) => m.month)).toEqual(['2026-09', '2026-08'])
    expect(report.months[0]!.sessions).toBe(2)
    expect(report.months[0]!.cost).toBe(5)
    expect(report.months[1]!.sessions).toBe(1)
  })

  it('orders months newest first', () => {
    const report = buildCostReport([
      session({ id: 'a', createdAt: localMonthTs('2026-01', 1) }),
      session({ id: 'b', createdAt: localMonthTs('2026-09', 1) }),
      session({ id: 'c', createdAt: localMonthTs('2026-05', 1) }),
    ])
    expect(report.months.map((m) => m.month)).toEqual(['2026-09', '2026-05', '2026-01'])
  })

  it('sorts each month projects by cost, most expensive first', () => {
    const report = buildCostReport([
      session({ id: 'a', project: 'robia', cost: 1 }),
      session({ id: 'b', project: 'robin', cost: 5 }),
      session({ id: 'c', project: 'robia', cost: 1 }),
    ])
    expect(report.months[0]!.projects).toEqual([
      { project: 'robin', sessions: 1, cost: 5 },
      { project: 'robia', sessions: 2, cost: 2 },
    ])
  })

  it("names the month's costliest session as its record", () => {
    const report = buildCostReport([
      session({ id: 'a', title: 'Cheap', cost: 1 }),
      session({ id: 'b', title: 'Pricey', project: 'robin', cost: 9 }),
    ])
    expect(report.months[0]!.record).toEqual({ id: 'b', title: 'Pricey', project: 'robin', cost: 9 })
  })

  it('has no record for a month where nothing cost anything', () => {
    const report = buildCostReport([session({ cost: 0 })])
    expect(report.months[0]!.record).toBeNull()
  })

  it('totals the whole history and marks its start', () => {
    const report = buildCostReport([
      session({ id: 'a', createdAt: localMonthTs('2026-01', 1), cost: 1 }),
      session({ id: 'b', createdAt: localMonthTs('2026-09', 1), cost: 2 }),
    ])
    expect(report.total).toBe(3)
    expect(report.sessions).toBe(2)
    expect(report.since).toBe(localMonthTs('2026-01', 1))
  })
})
