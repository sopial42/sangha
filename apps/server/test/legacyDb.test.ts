import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ORCHESTRATOR_SESSION_ID } from '@sangha/shared'
import { Store } from '../src/db'

// A database as older versions left it: tables, ids and stored values still in the old vocabulary.
function writeOldDatabase(path: string) {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, claude_session_id TEXT,
      agent TEXT NOT NULL DEFAULT 'lead', branch TEXT, worktree TEXT, base_sha TEXT, archived_at INTEGER,
      last_seen_seq INTEGER NOT NULL DEFAULT 0, engine TEXT NOT NULL DEFAULT 'claude', model TEXT
    );
    CREATE TABLE events (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, at INTEGER NOT NULL, ev TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
    CREATE TABLE ai_notes (session_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session_id, kind));
    CREATE TABLE shepherds (session_id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE lotus (session_id TEXT PRIMARY KEY);
    CREATE TABLE silenced (session_id TEXT PRIMARY KEY);
    CREATE TABLE notes (session_id TEXT PRIMARY KEY, note TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE elder_topics (id TEXT PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE elder_reports (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, topic_ids TEXT NOT NULL, cost_usd REAL, tokens INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE elder_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE project_colors (name TEXT PRIMARY KEY, color TEXT NOT NULL);
    CREATE TABLE mcp_global (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
    CREATE TABLE project_mcp (project TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (project, name));
  `)
  const session = db.prepare('INSERT INTO sessions (id, project, agent, title, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)')
  session.run('buddha', 'sangha', 'buddha', 'Orchestrator', 1, null)
  session.run('s1', 'robia', 'lead', 'Fix the login', 2, null)
  session.run('s2', 'robia', 'lead', 'Old work', 3, 50)
  const event = db.prepare('INSERT INTO events (session_id, seq, at, ev) VALUES (?, ?, ?, ?)')
  const events: [string, unknown][] = [
    ['buddha', { t: 'user.message', text: 'start something' }],
    ['buddha', { t: 'buddha.text', text: 'Started s1 for you, "naïvely" 🙂' }],
    ['s1', { t: 'buddha.tool', tool: 'Bash', summary: 'gh pr view' }],
    ['s1', { t: 'monk.summoned', monkId: 'toolu_a', agentType: 'back', description: 'backend', prompt: 'do it', depth: 0 }],
    ['s1', { t: 'monk.tool', monkId: 'toolu_a', tool: 'Read', summary: 'a.ts' }],
    ['s1', { t: 'monk.text', monkId: 'toolu_a', text: 'mentions "monkId": in its own words' }],
    ['s1', { t: 'monk.progress', monkId: 'toolu_a', description: 'backend', tokens: 10, toolUses: 1 }],
    ['s1', { t: 'monk.done', monkId: 'toolu_a', status: 'completed', summary: 'done' }],
    ['s1', { t: 'monk.summoned', monkId: 'toolu_b', agentType: 'front', description: 'ui', prompt: 'p', depth: 0 }],
    ['s1', { t: 'recap', done: 'Login fixed', next: 'CI', state: 'attente' }],
    ['s1', { t: 'busy', busy: false }],
  ]
  events.forEach(([id, ev], i) => event.run(id, i + 1, 1000 + i, JSON.stringify(ev)))
  const note = db.prepare('INSERT INTO ai_notes (session_id, kind, key, value, at) VALUES (?, ?, ?, ?, ?)')
  note.run('s1', 'recap', 'k1', JSON.stringify({ done: 'd', next: 'n', state: 'fini' }), 1)
  note.run('s2', 'nirvana', '50', JSON.stringify({ summary: 'It shipped the old work.' }), 1)
  db.prepare('INSERT INTO shepherds (session_id, value) VALUES (?, ?)').run('s1', JSON.stringify({ state: 'pending', nextAt: 5, askedAt: 0, seenAt: 5, attempts: 0, note: null }))
  db.prepare('INSERT INTO lotus (session_id) VALUES (?)').run('s1')
  db.prepare('INSERT INTO silenced (session_id) VALUES (?)').run('buddha')
  db.prepare('INSERT INTO notes (session_id, note) VALUES (?, ?)').run('buddha', 'the boss')
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('elder', JSON.stringify({ enabled: false, model: 'opus' }))
  db.prepare('INSERT INTO elder_topics VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('t1', 'sangha', 'Title', 'Detail', JSON.stringify(['buddha', 's1']), 'proposed', 1, 2)
  db.prepare('INSERT INTO elder_reports VALUES (?, ?, ?, ?, ?, ?, ?)').run('r1', 'daily', 'Report', JSON.stringify(['t1']), 0.1, 10, 3)
  db.prepare('INSERT INTO elder_chat (role, text, created_at) VALUES (?, ?, ?)').run('user', 'hello', 1)
  db.prepare('INSERT INTO elder_chat (role, text, created_at) VALUES (?, ?, ?)').run('elder', 'hi there', 2)
  db.close()
}

describe('a database from an older version', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sangha-legacy-'))
    path = join(dir, 'sangha.db')
    writeOldDatabase(path)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('moves the orchestrator to its new id, with its events and everything keyed by it', () => {
    const s = new Store(path)
    expect(s.getSession('buddha')).toBeNull()
    expect(s.getSession(ORCHESTRATOR_SESSION_ID)).toMatchObject({ agent: 'orchestrator', title: 'Orchestrator' })
    expect(s.events(ORCHESTRATOR_SESSION_ID).map((e) => e.ev.t)).toEqual(['user.message', 'assistant.text'])
    expect(s.silencedIds().has(ORCHESTRATOR_SESSION_ID)).toBe(true)
    expect(s.notes().get(ORCHESTRATOR_SESSION_ID)).toBe('the boss')
    expect(s.advisorTopic('t1')!.evidence).toEqual([ORCHESTRATOR_SESSION_ID, 's1'])
  })

  it('reads old event types, fields and recap states under their new names', () => {
    const s = new Store(path)
    const evs = s.events('s1').map((e) => e.ev)
    expect(evs.map((e) => e.t)).toEqual([
      'assistant.tool',
      'subagent.started',
      'subagent.tool',
      'subagent.text',
      'subagent.progress',
      'subagent.done',
      'subagent.started',
      'recap',
      'busy',
    ])
    expect(evs[1]).toEqual({ t: 'subagent.started', subagentId: 'toolu_a', agentType: 'back', description: 'backend', prompt: 'do it', depth: 0 })
    expect(evs[3]).toEqual({ t: 'subagent.text', subagentId: 'toolu_a', text: 'mentions "monkId": in its own words' })
    expect(evs.some((e) => 'monkId' in e)).toBe(false)
    expect(s.events(ORCHESTRATOR_SESSION_ID)[1]!.ev).toEqual({ t: 'assistant.text', text: 'Started s1 for you, "naïvely" 🙂' })
    // Prefix lookups (which need `t` to stay first) and the event walkers still work.
    expect(s.lastEvent('s1', 'assistant.tool')!.ev.summary).toBe('gh pr view')
    expect(s.lastEvent('s1', 'recap')!.ev).toMatchObject({ state: 'waiting' })
    expect(s.lastIdleSeq('s1')).toBe(11)
    expect(s.danglingSubagents('s1')).toEqual(['toolu_b'])
    expect(s.note<{ state: string }>('s1', 'recap')!.value.state).toBe('done')
  })

  it('finds renamed tables, note kinds, settings and chat roles through the usual methods', () => {
    const s = new Store(path)
    expect(s.note<{ summary: string }>('s2', 'closed')!.value.summary).toBe('It shipped the old work.')
    expect(s.handoff('s1')).toMatchObject({ state: 'pending', nextAt: 5 })
    expect(s.setAsideIds()).toEqual(new Set(['s1']))
    expect(s.setting('advisor')).toEqual({ enabled: false, model: 'opus' })
    expect(s.setting('elder')).toBeNull()
    expect(s.advisorReports().map((r) => r.id)).toEqual(['r1'])
    expect(s.advisorChat().map((t) => [t.role, t.text])).toEqual([
      ['user', 'hello'],
      ['advisor', 'hi there'],
    ])
    expect(s.advisorSanghaStats(0).handedOff).toBe(1)
  })

  it('migrates once: reopening changes nothing, and new rows are left as written', () => {
    new Store(path)
    const s = new Store(path)
    s.setSetAside('s2', true)
    s.addAdvisorChatMessage('advisor', 'again', 3)
    const again = new Store(path)
    expect(again.getSession(ORCHESTRATOR_SESSION_ID)).not.toBeNull()
    expect(again.events('s1')).toHaveLength(9)
    expect(again.setAsideIds()).toEqual(new Set(['s1', 's2']))
    expect(again.advisorChat()).toHaveLength(3)
    const raw = new DatabaseSync(path)
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining(['advisor_topics', 'advisor_reports', 'advisor_chat', 'handoffs', 'set_aside', 'migrations']))
    expect(tables.filter((t) => ['elder_topics', 'elder_reports', 'elder_chat', 'shepherds', 'lotus'].includes(t))).toEqual([])
    raw.close()
  })

  it('merges an old table an older version recreated beside the renamed one', () => {
    new Store(path)
    const raw = new DatabaseSync(path)
    raw.exec("CREATE TABLE lotus (session_id TEXT PRIMARY KEY); INSERT INTO lotus VALUES ('s2');")
    raw.close()
    expect(new Store(path).setAsideIds()).toEqual(new Set(['s1', 's2']))
  })

  it('leaves a fresh database alone', () => {
    const s = new Store(':memory:')
    expect(s.getSession(ORCHESTRATOR_SESSION_ID)).toBeNull()
    expect(s.setting('advisor')).toBeNull()
  })
})
