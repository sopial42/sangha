import { describe, expect, it } from 'vitest'
import type { HostMetric, HostMetricKey, HostWorktree } from '@sangha/shared'
import {
  GB,
  RED_AFTER_MS,
  RedTracker,
  WorktreeCommentCache,
  classifyWorktree,
  isInUse,
  ownerCandidates,
  parseDockerStats,
  parseLsofCwds,
  parseMeminfo,
  parsePs,
  parseSwapUsage,
  parseVmStat,
  parseWorktreeList,
  removableInfo,
  removeCommand,
  suggest,
  worktreeName,
  type HostNirvanaWorktree,
} from '../src/host'

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

  it('parses `git worktree list --porcelain` into one entry per worktree, main checkout included', () => {
    const out = [
      'worktree /repo',
      'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/p/lead-1',
      'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'branch refs/heads/sangha/lead-1',
      '',
    ].join('\n')
    expect(parseWorktreeList(out)).toEqual([
      { path: '/repo', head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch: 'main' },
      { path: '/repo/.worktrees/p/lead-1', head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', branch: 'sangha/lead-1' },
    ])
  })

  it('keeps a detached worktree (no branch line) with a null branch', () => {
    const out = ['worktree /repo/.worktrees/p/detached', 'HEAD cccccccccccccccccccccccccccccccccccccccc', 'detached', ''].join('\n')
    expect(parseWorktreeList(out)).toEqual([{ path: '/repo/.worktrees/p/detached', head: 'cccccccccccccccccccccccccccccccccccccccc', branch: null }])
  })

  it('reads a cwd per process from `lsof -a -d cwd -Fpn`', () => {
    const out = ['p111', 'n/w/.worktrees/p/busy', 'p222', 'n/w/.worktrees/p/other/sub'].join('\n')
    expect(parseLsofCwds(out)).toEqual(['/w/.worktrees/p/busy', '/w/.worktrees/p/other/sub'])
  })
})

describe('isInUse', () => {
  const cwds = ['/w/.worktrees/p/busy', '/w/.worktrees/p/other/sub']

  it('matches a worktree a process sits in, or sits under', () => {
    expect(isInUse('/w/.worktrees/p/busy', cwds)).toBe(true)
    expect(isInUse('/w/.worktrees/p/other', cwds)).toBe(true)
  })

  it('does not match a sibling that merely shares a path prefix', () => {
    expect(isInUse('/w/.worktrees/p/busy2', cwds)).toBe(false)
  })

  it('is false when nothing runs there', () => {
    expect(isInUse('/w/.worktrees/p/idle', cwds)).toBe(false)
  })
})

describe('worktreeName', () => {
  const root = '/w/.worktrees'

  it('names a worktree by its path under workspaces/.worktrees/<project>/', () => {
    expect(worktreeName('/w/.worktrees/p/lead-1', { name: 'p', path: '/w/p' }, root)).toBe('lead-1')
  })

  it('names a worktree living inside the repository itself (e.g. a Claude Code sub-agent) by its path under the repo', () => {
    expect(worktreeName('/w/p/.claude/worktrees/agent-xyz', { name: 'p', path: '/w/p' }, root)).toBe('.claude/worktrees/agent-xyz')
  })

  it('falls back to the basename for a worktree living elsewhere entirely', () => {
    expect(worktreeName('/elsewhere/clone', { name: 'p', path: '/w/p' }, root)).toBe('clone')
  })
})

describe('removeCommand', () => {
  it('scopes the removal to the worktree with -C, so it works from any cwd, and never forces it', () => {
    expect(removeCommand('/w/.worktrees/p/old')).toBe('git -C "/w/.worktrees/p/old" worktree remove "/w/.worktrees/p/old"')
  })
})

describe('ownerCandidates and classifyWorktree', () => {
  const liveWorking = { id: 's1', cwd: '/w/.worktrees/p/lead-1', note: 'LGT', title: 'Lead', status: 'working' as const }
  const liveIdle = { id: 's2', cwd: '/w/.worktrees/p/lead-2', note: null, title: 'Lead 2', status: 'idle' as const }
  const nirvanaEntry: HostNirvanaWorktree = { id: 'p3', path: '/w/.worktrees/p/lead-3', title: 'kiat team lead', note: '🦺🦺🦺🦺', archivedAt: 1 }

  it('is a priest when a live session works right there', () => {
    const candidates = ownerCandidates([liveWorking], [])
    expect(classifyWorktree('/w/.worktrees/p/lead-1', candidates)).toEqual({ kind: 'priest', owner: null })
  })

  it('is a subagent when nested under a live priest worktree\'s .claude/worktrees', () => {
    const candidates = ownerCandidates([liveWorking], [])
    expect(classifyWorktree('/w/.worktrees/p/lead-1/.claude/worktrees/agent-abc', candidates)).toEqual({
      kind: 'subagent',
      owner: { sessionId: 's1', note: 'LGT', title: 'Lead', alive: true, working: true },
    })
  })

  it('is a subagent when nested under an archived (nirvana) priest\'s worktree', () => {
    const candidates = ownerCandidates([], [nirvanaEntry])
    expect(classifyWorktree('/w/.worktrees/p/lead-3/.claude/worktrees/agent-abc', candidates)).toEqual({
      kind: 'subagent',
      owner: { sessionId: 'p3', note: '🦺🦺🦺🦺', title: 'kiat team lead', alive: false, working: false },
    })
  })

  it('is a subagent when its name is the owner worktree\'s name plus a suffix, in the same folder', () => {
    const candidates = ownerCandidates([], [nirvanaEntry])
    expect(classifyWorktree('/w/.worktrees/p/lead-3-e179', candidates)).toEqual({
      kind: 'subagent',
      owner: { sessionId: 'p3', note: '🦺🦺🦺🦺', title: 'kiat team lead', alive: false, working: false },
    })
  })

  it('does not match a name prefix across different folders', () => {
    const candidates = ownerCandidates([], [{ ...nirvanaEntry, path: '/other/project/lead-3' }])
    expect(classifyWorktree('/w/.worktrees/p/lead-3-e179', candidates)).toEqual({ kind: 'orphan', owner: null })
  })

  it('prefers an exact live match (priest) over a name-prefix match', () => {
    // lead-2 happens to live in the same folder as a worktree literally named lead-2 itself: it is the priest, not a subagent of someone else.
    const candidates = ownerCandidates([liveWorking, liveIdle], [])
    expect(classifyWorktree('/w/.worktrees/p/lead-2', candidates)).toEqual({ kind: 'priest', owner: null })
  })

  it('is an orphan when nothing claims it, even if its path matches a nirvana entry directly (kept for the existing nirvana naming)', () => {
    const candidates = ownerCandidates([], [nirvanaEntry])
    expect(classifyWorktree('/w/.worktrees/p/lead-3', candidates)).toEqual({ kind: 'orphan', owner: null })
  })

  it('is an orphan when nobody at all claims it', () => {
    expect(classifyWorktree('/w/.worktrees/p/nobody', ownerCandidates([liveWorking], [nirvanaEntry]))).toEqual({ kind: 'orphan', owner: null })
  })
})

describe('removableInfo', () => {
  const clean = { dirty: 0, unpushed: 0, inUse: false }
  const idleOwner = { sessionId: 's3', note: null, title: 'Sous-agent', alive: false, working: false }
  const workingOwner = { sessionId: 's3', note: 'LGT', title: 'Sous-agent', alive: true, working: true }

  it('is never removable before it was checked on disk', () => {
    expect(removableInfo('orphan', clean, null, { checked: false, external: false })).toEqual({ removable: false, blocker: 'vérification en cours' })
  })

  it('an orphan made outside Sangha (Kiat Operator, /tmp…) is never called safe', () => {
    expect(removableInfo('orphan', clean, null, { checked: true, external: true }).removable).toBe(false)
    expect(removableInfo('orphan', clean, null, { checked: true, external: false }).removable).toBe(true)
  })

  it('a priest\'s own worktree is never removable', () => {
    expect(removableInfo('priest', clean, null)).toEqual({ removable: false, blocker: "c'est le worktree d'un prêtre vivant : envoie-le au nirvana" })
  })

  it('blocks on uncommitted changes, counting files', () => {
    expect(removableInfo('orphan', { ...clean, dirty: 3 }, null)).toEqual({ removable: false, blocker: '3 fichiers modifiés' })
    expect(removableInfo('orphan', { ...clean, dirty: 1 }, null)).toEqual({ removable: false, blocker: '1 fichier modifié' })
  })

  it('blocks on commits never pushed', () => {
    expect(removableInfo('orphan', { ...clean, unpushed: 2 }, null)).toEqual({ removable: false, blocker: '2 commits jamais poussés' })
    expect(removableInfo('orphan', { ...clean, unpushed: 1 }, null)).toEqual({ removable: false, blocker: '1 commit jamais poussé' })
  })

  it('blocks while a process runs inside', () => {
    expect(removableInfo('orphan', { ...clean, inUse: true }, null)).toEqual({ removable: false, blocker: 'un process tourne dedans' })
  })

  it('blocks a subagent whose owner still works', () => {
    expect(removableInfo('subagent', clean, workingOwner)).toEqual({ removable: false, blocker: 'son prêtre « LGT » travaille encore' })
  })

  it('is removable once clean, pushed, unused, and its owner (if any) is not working', () => {
    expect(removableInfo('subagent', clean, idleOwner)).toEqual({ removable: true, blocker: null })
    expect(removableInfo('orphan', clean, null)).toEqual({ removable: true, blocker: null })
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

  const wt = (over: Partial<HostWorktree>): HostWorktree => ({
    path: '/w/.worktrees/p/x',
    project: 'p',
    name: 'x',
    bytes: 0,
    sessionId: null,
    sessionTitle: null,
    sessionNote: null,
    status: null,
    kind: 'orphan',
    owner: null,
    dirty: 0,
    unpushed: 0,
    inUse: false,
    removable: true,
    blocker: null,
    removeCommand: '',
    comment: null,
    ...over,
  })

  it('says nothing while it has been red for less than 5 minutes', () => {
    expect(suggest({ ...base, metrics: [metric('cpu', now - RED_AFTER_MS + 1)] })).toEqual([])
  })

  it('points at the busiest container, else at the busiest process', () => {
    const containers = [{ id: 'x', name: 'stack-api-1', image: 'api', cpu: 180, memBytes: GB, memPct: 5 }]
    const withDocker = suggest({ ...base, containers, metrics: [metric('cpu', now - RED_AFTER_MS)] })
    expect(withDocker[0]).toMatchObject({ metric: 'cpu', command: 'docker stop stack-api-1' })
    expect(suggest({ ...base, metrics: [metric('cpu', now - RED_AFTER_MS)] })[0]).toMatchObject({ command: 'kill 7' })
  })

  it('offers to dismiss the priest with the heaviest idle worktree, and to remove a removable orphan one', () => {
    const worktrees = [
      wt({ path: '/w/.worktrees/p/busy', name: 'busy', bytes: 9 * GB, sessionId: 's1', sessionTitle: 'Busy', status: 'working', kind: 'priest', removable: false, blocker: "c'est le worktree d'un prêtre vivant : envoie-le au nirvana" }),
      wt({ path: '/w/.worktrees/p/done', name: 'done', bytes: 4 * GB, sessionId: 's2', sessionTitle: 'Done', status: 'idle', kind: 'priest', removable: false, blocker: "c'est le worktree d'un prêtre vivant : envoie-le au nirvana" }),
      wt({ path: '/w/.worktrees/p/old', name: 'old', bytes: GB, removeCommand: removeCommand('/w/.worktrees/p/old') }),
    ]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s.map((x) => x.id)).toEqual(['disk:worktree:/w/.worktrees/p/done', 'disk:orphan:/w/.worktrees/p/old'])
    expect(s[0]?.sessionId).toBe('s2')
    expect(s[0]?.title).toContain('« Done »')
  })

  it('uses the removable worktree\'s own remove command, scoped with -C', () => {
    const worktrees = [wt({ path: '/w/.worktrees/p/old', name: 'old', bytes: GB, removeCommand: removeCommand('/w/.worktrees/p/old') })]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s[0]?.command).toBe('git -C "/w/.worktrees/p/old" worktree remove "/w/.worktrees/p/old"')
  })

  it('never suggests deleting a worktree that is not removable', () => {
    const worktrees = [
      wt({ path: '/w/.worktrees/p/dirty', name: 'dirty', bytes: 3 * GB, removable: false, blocker: '3 fichiers modifiés' }),
    ]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s.find((x) => x.id.startsWith('disk:orphan:'))).toBeUndefined()
  })

  it('names a removable sub-agent worktree after its owner, note first, saying when he is gone to nirvana', () => {
    const worktrees = [
      wt({
        path: '/w/.worktrees/p/lead-3-e179',
        name: 'lead-3-e179',
        bytes: GB,
        kind: 'subagent',
        owner: { sessionId: 'p3', note: '🦺🦺🦺🦺', title: 'kiat team lead', alive: false, working: false },
        removeCommand: removeCommand('/w/.worktrees/p/lead-3-e179'),
      }),
    ]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s[0]?.title).toBe('Worktree sans prêtre : un worktree de sous-agent de « 🦺🦺🦺🦺 » (parti au nirvana) (1.0 Go)')
  })

  it('names the idle priest by his note first, title shortened alongside, when he has one', () => {
    const worktrees = [
      wt({
        path: '/w/.worktrees/p/done',
        name: 'done',
        bytes: 2 * GB,
        sessionId: 's2',
        sessionTitle: 'je veux developper deux écrans de paiement',
        sessionNote: 'RIB ET MAIL',
        status: 'idle',
        kind: 'priest',
        removable: false,
        blocker: "c'est le worktree d'un prêtre vivant : envoie-le au nirvana",
      }),
    ]
    const s = suggest({ ...base, worktrees, metrics: [metric('disk', 0)] })
    expect(s[0]?.title).toBe('Disque plein depuis 50 min : le worktree de « RIB ET MAIL » (je veux developper deux…) pèse 2.0 Go')
  })

  it('names an orphan worktree after the nirvana entry that used it, note first', () => {
    const worktrees = [wt({ path: '/w/.worktrees/p/old', name: 'old', bytes: GB, removeCommand: removeCommand('/w/.worktrees/p/old') })]
    const nirvana = [{ id: 'n1', path: '/w/.worktrees/p/old', title: 'je corrige le panier', note: 'RIB ET MAIL', archivedAt: new Date(2026, 2, 7).getTime() }]
    const s = suggest({ ...base, worktrees, nirvana, metrics: [metric('disk', 0)] })
    expect(s[0]?.title).toBe('Worktree sans prêtre : « RIB ET MAIL » (je corrige le panier), parti au nirvana le 07/03 (1.0 Go)')
  })

  it('falls back to the title alone when the nirvana match has no note', () => {
    const worktrees = [wt({ path: '/w/.worktrees/p/old', name: 'old', bytes: GB, removeCommand: removeCommand('/w/.worktrees/p/old') })]
    const nirvana = [{ id: 'n1', path: '/w/.worktrees/p/old', title: 'je corrige le panier', note: null, archivedAt: new Date(2026, 2, 7).getTime() }]
    const s = suggest({ ...base, worktrees, nirvana, metrics: [metric('disk', 0)] })
    expect(s[0]?.title).toBe('Worktree sans prêtre : « je corrige le panier », parti au nirvana le 07/03 (1.0 Go)')
  })

  it('keeps naming it by path when no nirvana entry ever used it', () => {
    const worktrees = [wt({ path: '/w/.worktrees/p/old', name: 'old', bytes: GB, removeCommand: removeCommand('/w/.worktrees/p/old') })]
    const s = suggest({ ...base, worktrees, nirvana: [], metrics: [metric('disk', 0)] })
    expect(s[0]?.title).toBe('Worktree sans prêtre : p/old (1.0 Go)')
  })
})

describe('WorktreeCommentCache', () => {
  const entry = (over: Partial<{ path: string; name: string; branch: string | null; commits: string[]; dirty: number; unpushed: number; owner: string | null; headSha: string | null }> = {}) => ({
    path: '/w/.worktrees/p/old',
    name: 'p/old',
    branch: 'sangha/x',
    commits: ['un commit'],
    dirty: 0,
    unpushed: 0,
    owner: null,
    headSha: 'sha1',
    ...over,
  })

  it('is null until a comment has been written for that path and HEAD', () => {
    const cache = new WorktreeCommentCache(async () => ({}))
    expect(cache.of('/w/.worktrees/p/old', 'sha1')).toBeNull()
  })

  it('asks the model and caches the answer by path and HEAD sha', async () => {
    let asked: unknown[] = []
    const cache = new WorktreeCommentCache(async (entries) => {
      asked = entries
      return { '/w/.worktrees/p/old': 'Un vieux brouillon, probablement fusionné.' }
    })
    await cache.refresh([entry()])
    expect(asked).toHaveLength(1)
    expect(cache.of('/w/.worktrees/p/old', 'sha1')).toBe('Un vieux brouillon, probablement fusionné.')
  })

  it('never asks again for the same path and HEAD sha', async () => {
    let calls = 0
    const cache = new WorktreeCommentCache(async () => {
      calls++
      return { '/w/.worktrees/p/old': 'commentaire' }
    })
    await cache.refresh([entry()])
    await cache.refresh([entry()])
    expect(calls).toBe(1)
  })

  it('asks again once the HEAD sha changes (new commits since the last comment)', async () => {
    let calls = 0
    const cache = new WorktreeCommentCache(async (entries) => {
      calls++
      return Object.fromEntries(entries.map((e) => [e.path, `commentaire ${calls}`]))
    })
    await cache.refresh([entry({ headSha: 'sha1' })])
    await cache.refresh([entry({ headSha: 'sha2' })])
    expect(calls).toBe(2)
    expect(cache.of('/w/.worktrees/p/old', 'sha1')).toBe('commentaire 1')
    expect(cache.of('/w/.worktrees/p/old', 'sha2')).toBe('commentaire 2')
  })
})
