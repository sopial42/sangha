import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Envelope, MonasteryEvent, Quota, SessionInfo } from '@sangha/shared'

export type NoteKind = 'recap' | 'progress' | 'doing' | 'nirvana'
export type Note<T> = { key: string; value: T; at: number }

export type Renewal = { bucket: number; state: 'asked' | 'postponed' | 'done'; askedAt: number }

/**
 * Buddha seeing a priest through to a fresh session. pending: he asks again at `nextAt`; asked: awaiting
 * the answer to the question sent at `askedAt`; refused: an outright no; done: he moved on.
 * `seenAt`: his words before this are already read. `note`: his last answer.
 */
export type Shepherd = { state: 'pending' | 'asked' | 'refused' | 'done'; nextAt: number; askedAt: number; seenAt: number; attempts: number; note: string | null }

export type SessionRow = SessionInfo & {
  worktree: string | null
  baseSha: string | null
  archivedAt: number | null
  lastSeenSeq: number
}

// Added after v1; created on older databases by migrate().
const SESSION_COLUMNS: Record<string, string> = {
  agent: "TEXT NOT NULL DEFAULT 'lead'",
  branch: 'TEXT',
  worktree: 'TEXT',
  base_sha: 'TEXT',
  archived_at: 'INTEGER',
  last_seen_seq: 'INTEGER NOT NULL DEFAULT 0',
}

// Index of sessions and their event log. Claude Code's own JSONL transcripts
// remain the source of truth for the conversation (used by resume).
export class Store {
  private db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claude_session_id TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        at INTEGER NOT NULL,
        ev TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS project_colors (
        name TEXT PRIMARY KEY,
        color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_notes (
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (session_id, kind)
      );
      CREATE TABLE IF NOT EXISTS renewals (
        session_id TEXT PRIMARY KEY,
        bucket INTEGER NOT NULL,
        state TEXT NOT NULL,
        asked_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shepherds (
        session_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hidden_sessions (
        session_id TEXT PRIMARY KEY,
        until_move_after INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS carried_costs (
        session_id TEXT PRIMARY KEY,
        usd REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS silenced (
        session_id TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS ignored_projects (
        path TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS local_projects (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
      );
    `)
    this.migrate()
  }

  private migrate() {
    const have = new Set((this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name))
    for (const [col, def] of Object.entries(SESSION_COLUMNS)) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`)
    }
  }

  createSession(s: SessionRow) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project, agent, title, created_at, claude_session_id, branch, worktree, base_sha, archived_at, last_seen_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.project, s.agent, s.title, s.createdAt, s.claudeSessionId, s.branch, s.worktree, s.baseSha, s.archivedAt, s.lastSeenSeq)
  }

  listSessions(): SessionRow[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE archived_at IS NULL ORDER BY created_at').all() as Row[]).map(toSession)
  }

  /** Every session ever created, archived included, for the monastery-wide cost report. */
  allSessions(): SessionRow[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY created_at').all() as Row[]).map(toSession)
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined
    return row ? toSession(row) : null
  }

  setClaudeSessionId(id: string, claudeSessionId: string) {
    this.db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(claudeSessionId, id)
  }

  setTitle(id: string, title: string) {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  archive(id: string) {
    this.db.prepare('UPDATE sessions SET archived_at = ? WHERE id = ?').run(Date.now(), id)
  }

  /** Sent to nirvana: archived sessions, newest dismissal first, at most `limit`. */
  archivedSessions(limit = 200): SessionRow[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ?').all(limit) as Row[]).map(toSession)
  }

  /** Reincarnate: bring an archived session back into the courtyard. */
  unarchive(id: string) {
    this.db.prepare('UPDATE sessions SET archived_at = NULL WHERE id = ?').run(id)
  }

  markSeen(id: string) {
    this.db.prepare('UPDATE sessions SET last_seen_seq = (SELECT COALESCE(MAX(seq), 0) FROM events WHERE session_id = ?) WHERE id = ?').run(id, id)
  }

  append(sessionId: string, ev: MonasteryEvent): Envelope {
    const { seq } = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE session_id = ?').get(sessionId) as { seq: number }
    const env: Envelope = { seq, at: Date.now(), ev }
    this.db.prepare('INSERT INTO events (session_id, seq, at, ev) VALUES (?, ?, ?, ?)').run(sessionId, seq, env.at, JSON.stringify(ev))
    return env
  }

  events(sessionId: string, afterSeq = 0): Envelope[] {
    return (this.db.prepare('SELECT seq, at, ev FROM events WHERE session_id = ? AND seq > ? ORDER BY seq').all(sessionId, afterSeq) as EventRow[]).map((r) => ({
      seq: r.seq,
      at: r.at,
      ev: JSON.parse(r.ev),
    }))
  }

  /** Novices summoned but never reported done: after a restart, their process is gone. */
  danglingNovices(sessionId: string): string[] {
    const open = new Set<string>()
    for (const { ev } of this.events(sessionId)) {
      if (ev.t === 'monk.summoned') open.add(ev.monkId)
      if (ev.t === 'monk.done') open.delete(ev.monkId)
    }
    return [...open]
  }

  /** Latest event of a given type, e.g. to know whether a session was busy when the server stopped. */
  lastEvent<T extends MonasteryEvent['t']>(sessionId: string, t: T): (Envelope & { ev: Extract<MonasteryEvent, { t: T }> }) | null {
    const r = this.db
      .prepare('SELECT seq, at, ev FROM events WHERE session_id = ? AND ev LIKE ? ORDER BY seq DESC LIMIT 1')
      .get(sessionId, `{"t":"${t}"%`) as EventRow | undefined
    return r ? { seq: r.seq, at: r.at, ev: JSON.parse(r.ev) } : null
  }

  /** Most recent plan quota seen by any session, so the gauge is right from the first page load. */
  latestQuota(): Quota | null {
    const r = this.db.prepare(`SELECT ev FROM events WHERE ev LIKE '{"t":"quota"%' ORDER BY at DESC LIMIT 1`).get() as { ev: string } | undefined
    return r ? (JSON.parse(r.ev) as { quota: Quota }).quota : null
  }

  /** Seq of the latest moment the session fell idle (busy:false). */
  lastIdleSeq(sessionId: string): number {
    const r = this.db
      .prepare('SELECT MAX(seq) AS seq FROM events WHERE session_id = ? AND ev = ?')
      .get(sessionId, JSON.stringify({ t: 'busy', busy: false })) as { seq: number | null }
    return r.seq ?? 0
  }

  /** Projects that live anywhere on this machine, registered by path. */
  localProjects(): { name: string; path: string }[] {
    return this.db.prepare('SELECT name, path FROM local_projects ORDER BY added_at').all() as { name: string; path: string }[]
  }

  addLocalProject(name: string, path: string) {
    this.db.prepare('INSERT INTO local_projects (name, path, added_at) VALUES (?, ?, ?)').run(name, path, Date.now())
  }

  removeLocalProject(name: string) {
    this.db.prepare('DELETE FROM local_projects WHERE name = ?').run(name)
  }

  /**
   * Texts a small model wrote about a session (recap, progress, what he is doing), kept with the state
   * they describe (`key`), so a reload or a restart reuses them instead of asking again.
   */
  note<T>(id: string, kind: NoteKind): Note<T> | null {
    const r = this.db.prepare('SELECT key, value, at FROM ai_notes WHERE session_id = ? AND kind = ?').get(id, kind) as { key: string; value: string; at: number } | undefined
    return r ? { key: r.key, value: JSON.parse(r.value) as T, at: r.at } : null
  }

  setNote(id: string, kind: NoteKind, key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO ai_notes (session_id, kind, key, value, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, kind) DO UPDATE SET key = excluded.key, value = excluded.value, at = excluded.at')
      .run(id, kind, key, JSON.stringify(value), Date.now())
  }

  /** Where each session stands on moving to a fresh one (asked at which context size, and its answer). */
  renewal(id: string): Renewal | null {
    const r = this.db.prepare('SELECT bucket, state, asked_at FROM renewals WHERE session_id = ?').get(id) as { bucket: number; state: string; asked_at: number } | undefined
    return r ? { bucket: r.bucket, state: r.state as Renewal['state'], askedAt: r.asked_at } : null
  }

  setRenewal(id: string, r: Renewal | null) {
    if (!r) this.db.prepare('DELETE FROM renewals WHERE session_id = ?').run(id)
    else
      this.db
        .prepare('INSERT INTO renewals (session_id, bucket, state, asked_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET bucket = excluded.bucket, state = excluded.state, asked_at = excluded.asked_at')
        .run(id, r.bucket, r.state, r.askedAt)
  }

  shepherd(id: string): Shepherd | null {
    const r = this.db.prepare('SELECT value FROM shepherds WHERE session_id = ?').get(id) as { value: string } | undefined
    return r ? (JSON.parse(r.value) as Shepherd) : null
  }

  setShepherd(id: string, s: Shepherd | null) {
    if (!s) this.db.prepare('DELETE FROM shepherds WHERE session_id = ?').run(id)
    else this.db.prepare('INSERT INTO shepherds (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value').run(id, JSON.stringify(s))
  }

  /** Outside sessions sent away from the courtyard, with the activity date they had then (they return if they move again). */
  hiddenSessions(): Map<string, number> {
    const rows = this.db.prepare('SELECT session_id AS id, until_move_after AS at FROM hidden_sessions').all() as { id: string; at: number }[]
    return new Map(rows.map((r) => [r.id, r.at]))
  }

  setHidden(id: string, at: number) {
    this.db.prepare('INSERT INTO hidden_sessions (session_id, until_move_after) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET until_move_after = excluded.until_move_after').run(id, at)
  }

  /** What the sessions this one took over from had already cost (it moved on to a fresh session). */
  carriedCost(id: string): number {
    const r = this.db.prepare('SELECT usd FROM carried_costs WHERE session_id = ?').get(id) as { usd: number } | undefined
    return r?.usd ?? 0
  }

  setCarriedCost(id: string, usd: number) {
    this.db.prepare('INSERT INTO carried_costs (session_id, usd) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET usd = excluded.usd').run(id, usd)
  }

  /** Sessions you asked to keep quiet (Sangha priests and outside sessions alike). */
  silencedIds(): Set<string> {
    return new Set((this.db.prepare('SELECT session_id AS id FROM silenced').all() as { id: string }[]).map((r) => r.id))
  }

  setSilenced(id: string, silent: boolean) {
    if (silent) this.db.prepare('INSERT OR IGNORE INTO silenced (session_id) VALUES (?)').run(id)
    else this.db.prepare('DELETE FROM silenced WHERE session_id = ?').run(id)
  }

  /** Folders you took out of the monastery: auto-detection must not bring them back. */
  ignoredProjects(): Set<string> {
    return new Set((this.db.prepare('SELECT path FROM ignored_projects').all() as { path: string }[]).map((r) => r.path))
  }

  setIgnored(path: string, ignored: boolean) {
    if (ignored) this.db.prepare('INSERT OR IGNORE INTO ignored_projects (path) VALUES (?)').run(path)
    else this.db.prepare('DELETE FROM ignored_projects WHERE path = ?').run(path)
  }

  /** Claude session ids driven by Sangha itself, so the observer does not mistake them for outside sessions. */
  claudeSessionIds(): Set<string> {
    const rows = this.db.prepare('SELECT claude_session_id AS id FROM sessions WHERE claude_session_id IS NOT NULL').all() as { id: string }[]
    return new Set(rows.map((r) => r.id))
  }

  /** Stable robe color per project: the first palette color no other project wears. */
  projectColor(name: string, palette: string[]): string {
    const row = this.db.prepare('SELECT color FROM project_colors WHERE name = ?').get(name) as { color: string } | undefined
    if (row) return row.color
    const used = new Set((this.db.prepare('SELECT color FROM project_colors').all() as { color: string }[]).map((r) => r.color))
    const color = palette.find((c) => !used.has(c)) ?? palette[used.size % palette.length]!
    this.db.prepare('INSERT INTO project_colors (name, color) VALUES (?, ?)').run(name, color)
    return color
  }
}

type Row = {
  id: string
  project: string
  agent: string
  title: string
  created_at: number
  claude_session_id: string | null
  branch: string | null
  worktree: string | null
  base_sha: string | null
  archived_at: number | null
  last_seen_seq: number
}
type EventRow = { seq: number; at: number; ev: string }

const toSession = (r: Row): SessionRow => ({
  id: r.id,
  project: r.project,
  agent: r.agent,
  title: r.title,
  createdAt: r.created_at,
  claudeSessionId: r.claude_session_id,
  branch: r.branch,
  worktree: r.worktree,
  baseSha: r.base_sha,
  archivedAt: r.archived_at,
  lastSeenSeq: r.last_seen_seq,
})
