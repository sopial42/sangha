import { describe, expect, it } from 'vitest'
import { parseElderResponse } from '../src/elderParse'

const LEVELS = { manual: true, sangha: true, project: true }
const PROJECTS = ['robia']

describe('parseElderResponse', () => {
  it('rejects anything without a report', () => {
    expect(parseElderResponse({ topics: [] }, new Set(), LEVELS, PROJECTS)).toBeNull()
    expect(parseElderResponse(null, new Set(), LEVELS, PROJECTS)).toBeNull()
  })

  it('keeps a topic update when its id is known', () => {
    const out = parseElderResponse({ report: 'nothing to report', topics: [{ id: 't1', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }] }, new Set(['t1']), LEVELS, PROJECTS)
    expect(out?.topics).toEqual([{ id: 't1', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }])
  })

  it('treats an unknown id as a new topic (drops the id), keeping the title', () => {
    const out = parseElderResponse({ report: 'r', topics: [{ id: 'ghost', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }] }, new Set(['t1']), LEVELS, PROJECTS)
    expect(out?.topics).toEqual([{ scope: 'sangha', title: 'x', detail: 'y', evidence: [] }])
  })

  it('rejects a scope from a disabled level, or an unfollowed project', () => {
    const levelsOff = { manual: true, sangha: false, project: true }
    const out = parseElderResponse(
      {
        report: 'r',
        topics: [
          { scope: 'sangha', title: 'a', detail: 'd', evidence: [] },
          { scope: 'project:ghost', title: 'b', detail: 'd', evidence: [] },
          { scope: 'project:robia', title: 'c', detail: 'd', evidence: [] },
        ],
      },
      new Set(),
      levelsOff,
      PROJECTS,
    )
    expect(out?.topics.map((t) => t.title)).toEqual(['c'])
  })

  it('caps new topics at 5, keeping updates uncapped', () => {
    const topics = Array.from({ length: 6 }, (_, i) => ({ scope: 'sangha', title: `t${i}`, detail: 'd', evidence: [] }))
    const out = parseElderResponse({ report: 'r', topics }, new Set(), LEVELS, PROJECTS)
    expect(out?.topics).toHaveLength(5)
  })

  it('rejects topics with an empty title or detail', () => {
    const out = parseElderResponse(
      { report: 'r', topics: [{ scope: 'sangha', title: '', detail: 'd', evidence: [] }, { scope: 'sangha', title: 't', detail: '', evidence: [] }] },
      new Set(),
      LEVELS,
      PROJECTS,
    )
    expect(out?.topics).toEqual([])
  })
})
