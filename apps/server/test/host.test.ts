import { describe, expect, it } from 'vitest'
import type { HostMetric, HostMetricKey } from '@sangha/shared'
import { GB, RED_AFTER_MS, RedTracker, parseDockerStats, parseMeminfo, parsePs, parseSwapUsage, parseVmStat, suggest } from '../src/host'

describe('parsers', () => {
  it('reads what macOS can give back without swapping', () => {
    const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                4266.
Pages active:                            149883.
Pages inactive:                          138042.
Pages speculative:                        11023.
Pages wired down:                        242935.
Pages purgeable:                             18.`
    expect(parseVmStat(out)).toBe((4266 + 138042 + 11023 + 18) * 16384)
  })

  it('reads the swap, whatever the decimal mark', () => {
    expect(parseSwapUsage('total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)')).toEqual({ total: 2048 * 1024 ** 2, used: 1024.5 * 1024 ** 2 })
    expect(parseSwapUsage('total = 2,00G  used = 1,00G  free = 1,00G')).toEqual({ total: 2 * GB, used: GB })
  })

  it('reads /proc/meminfo', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 250 kB\nSwapTotal: 400 kB\nSwapFree: 100 kB\n')).toEqual({
      total: 1000 * 1024,
      available: 250 * 1024,
      swapTotal: 400 * 1024,
      swapFree: 100 * 1024,
    })
  })

  it('keeps the heaviest processes, by name', () => {
    const out = '  843 132.1 472864 /Applications/Webex.app/Contents/MacOS/Webex\n   12   0.5   1000 node\n 70333  68.2 405968 /usr/bin/com.apple Virtual\n'
    expect(parsePs(out, 2)).toEqual([
      { pid: 843, cpu: 132.1, rssBytes: 472864 * 1024, command: 'Webex' },
      { pid: 70333, cpu: 68.2, rssBytes: 405968 * 1024, command: 'com.apple Virtual' },
    ])
  })

  it('reads docker stats and finds the images', () => {
    const out = [
      '{"ID":"aaaaaaaaaaaa","Name":"db","CPUPerc":"3.5%","MemPerc":"12.0%","MemUsage":"1.5GiB / 8GiB"}',
      'WARNING: something',
      '{"ID":"bbbbbbbbbbbb","Name":"api","CPUPerc":"150.2%","MemPerc":"1.0%","MemUsage":"200MiB / 8GiB"}',
    ].join('\n')
    expect(parseDockerStats(out, new Map([['aaaaaaaaaaaa', 'postgres:16']]))).toEqual([
      { id: 'bbbbbbbbbbbb', name: 'api', image: '', cpu: 150.2, memPct: 1, memBytes: 200 * 1024 ** 2 },
      { id: 'aaaaaaaaaaaa', name: 'db', image: 'postgres:16', cpu: 3.5, memPct: 12, memBytes: 1.5 * GB },
    ])
  })
})

describe('RedTracker', () => {
  it('remembers since when it is red, and one calm sample is not enough to forget', () => {
    const t = new RedTracker()
    expect(t.update('cpu', 'ok', 0)).toBeNull()
    expect(t.update('cpu', 'red', 10)).toBe(10)
    expect(t.update('cpu', 'red', 20)).toBe(10)
    expect(t.update('cpu', 'warn', 30)).toBe(10)
    expect(t.update('cpu', 'red', 40)).toBe(10)
    expect(t.update('cpu', 'ok', 50)).toBe(10)
    expect(t.update('cpu', 'ok', 60)).toBeNull()
    expect(t.update('cpu', 'red', 70)).toBe(70)
  })
})

describe('suggest', () => {
  const now = 10 * RED_AFTER_MS
  const metric = (key: HostMetricKey, redSince: number | null): HostMetric => ({ key, label: key, value: 1, detail: '', level: redSince == null ? 'ok' : 'red', redSince })
  const base = { now, processes: [{ pid: 7, command: 'cc1plus', cpu: 390, rssBytes: GB / 2 }], containers: null, worktrees: [], sessions: [] }

  it('says nothing while it has been red for less than 5 minutes', () => {
    expect(suggest({ ...base, metrics: [metric('cpu', now - RED_AFTER_MS + 1)] })).toEqual([])
  })

  it('points at the busiest container, else at the busiest process', () => {
    const containers = [{ id: 'x', name: 'stack-api-1', image: 'api', cpu: 180, memBytes: GB, memPct: 5 }]
    const withDocker = suggest({ ...base, containers, metrics: [metric('cpu', now - RED_AFTER_MS)] })
    expect(withDocker[0]).toMatchObject({ metric: 'cpu', command: 'docker stop stack-api-1' })
    expect(suggest({ ...base, metrics: [metric('cpu', now - RED_AFTER_MS)] })[0]).toMatchObject({ command: 'kill 7' })
  })

  it('offers to dismiss the priest with the heaviest idle worktree, and to remove an orphan one', () => {
    const worktrees = [
      { path: '/w/.worktrees/p/busy', project: 'p', name: 'busy', bytes: 9 * GB, sessionId: 's1', sessionTitle: 'Busy', status: 'working' as const },
      { path: '/w/.worktrees/p/done', project: 'p', name: 'done', bytes: 4 * GB, sessionId: 's2', sessionTitle: 'Done', status: 'idle' as const },
      { path: '/w/.worktrees/p/old', project: 'p', name: 'old', bytes: GB, sessionId: null, sessionTitle: null, status: null },
    ]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s.map((x) => x.id)).toEqual(['disk:worktree:/w/.worktrees/p/done', 'disk:orphan:/w/.worktrees/p/old'])
    expect(s[0]?.sessionId).toBe('s2')
  })
})
