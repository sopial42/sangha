import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AutonomyState, Engine, Envelope, ElderChatTurn, ElderReport, ElderTopic, Feedback, MonasteryEvent, Provider, QueuedMessage, Quota, SessionInfo } from '@sangha/shared'

/**
 * Sent straight to a session to end an active loop (see `Sessions.autonomy`): the exact words asked of him
 * when you stop it, so a loop still ends even if he never gets a turn to call `ScheduleWakeup(stop: true)`
 * or `CronDelete` himself (e.g. you stopped him mid-turn, or he ignores the instruction). `lastAutonomy`
 * below matches it verbatim as a second way a loop ends, alongside his own tool calls.
 */
export const LOOP_STOP_MESSAGE = "Arrête la boucle /loop : ne programme plus aucun réveil (ScheduleWakeup avec stop) et supprime tes tâches CronCreate. Ne fais rien d'autre."

export type NoteKind = 'recap' | 'progress' | 'doing' | 'nirvana'
export type Note<T> = { key: string; value: T; at: number }

export type Renewal = { bucket: number; state: 'asked' | 'postponed' | 'done'; askedAt: number }

/**
 * Buddha seeing a priest through to a fresh session. pending: he asks again at `nextAt`; asked: awaiting
 * the answer to the question sent at `askedAt`; refused: an outright no; done: he moved on.
 * `seenAt`: his words before this are already read. `note`: his last answer.
 */
export type Shepherd = {
  state: 'pending' | 'asked' | 'refused' | 'done'
  nextAt: number
  askedAt: number
  seenAt: number
  attempts: number
  note: string | null
  /** Your context for the fresh session, in a file under /tmp it reads first (see writeHandoffContext). */
  contextFile?: string | null
}

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
  engine: "TEXT NOT NULL DEFAULT 'claude'",
  model: 'TEXT',
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
      CREATE TABLE IF NOT EXISTS successors (
        session_id TEXT PRIMARY KEY,
        next_id TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS lotus (
        session_id TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS notes (
        session_id TEXT PRIMARY KEY,
        note TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS queued_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_env (
        session_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reminders (
        session_id TEXT PRIMARY KEY,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_mcp (
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        PRIMARY KEY (project, name)
      );
      CREATE TABLE IF NOT EXISTS mcp_global (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_mcp (
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        PRIMARY KEY (session_id, name)
      );
      CREATE TABLE IF NOT EXISTS ignored_projects (
        path TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS local_projects (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_seq INTEGER,
        rating TEXT,
        comment TEXT,
        excerpt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS elder_topics (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        evidence TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elder_reports (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        topic_ids TEXT NOT NULL,
        cost_usd REAL,
        tokens INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elder_chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    this.migrate()
  }

  private migrate() {
    const have = new Set((this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name))
    for (const [col, def] of Object.entries(SESSION_COLUMNS)) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`)
    }
    // MCP switches used to be kept per project: the first time, one switched on in any project is on for all.
    if (!this.db.prepare('SELECT 1 FROM mcp_global LIMIT 1').get()) {
      this.db.exec('INSERT INTO mcp_global (name, enabled) SELECT name, MAX(enabled) FROM project_mcp GROUP BY name')
    }
  }

  createSession(s: SessionRow) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project, agent, title, created_at, claude_session_id, branch, worktree, base_sha, archived_at, last_seen_seq, engine, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.project, s.agent, s.title, s.createdAt, s.claudeSessionId, s.branch, s.worktree, s.baseSha, s.archivedAt, s.lastSeenSeq, s.engine ?? 'claude', s.model ?? null)
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

  setModel(id: string, engine: Engine, model: string | null) {
    this.db.prepare('UPDATE sessions SET engine = ?, model = ? WHERE id = ?').run(engine, model, id)
  }

  setTitle(id: string, title: string) {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  archive(id: string) {
    this.db.prepare('UPDATE sessions SET archived_at = ? WHERE id = ?').run(Date.now(), id)
  }

  /** Sent to nirvana: archived sessions, newest dismissal first, at most `limit`. */
  /** Sessions still in the monastery that work in this folder (a priest and the one he renewed into share it). */
  othersInWorktree(worktree: string, exceptId: string): string[] {
    return (this.db.prepare('SELECT id FROM sessions WHERE worktree = ? AND id != ? AND archived_at IS NULL').all(worktree, exceptId) as { id: string }[]).map((r) => r.id)
  }

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

  /**
   * His autonomy — Claude Code `/goal` or `/loop`, never both at once (see `AutonomyState`) — derived from
   * the event log rather than a column of its own. The last `/goal ...` or `/loop ...` message decides
   * which mode is current: `Sessions.autonomy` only ever starts one after stopping the other, so whichever
   * command came last is the one that counts, and the fields of the other mode are simply dropped.
   *
   * `goal`: unchanged from before autonomy existed — a clear (`clear|stop|off|cancel`, case-insensitively,
   * or a bare `/goal`) goes inactive but keeps the text of the last real goal before it, so the UI can
   * offer to relaunch the same one.
   *
   * `loop`: the argument's leading `\d+[smhd]` token, if any, is the interval ("5m" etc. — a fixed
   * schedule, CronCreate); its absence means self-paced (ScheduleWakeup, called again every turn). Right
   * after the `/loop` message he is optimistically active (no turn has had the chance yet to prove
   * otherwise). From then on:
   *  - a `loop.wake` (see normalize.ts, emitted for his own ScheduleWakeup/CronCreate/CronDelete calls)
   *    sets `nextAt` and active/inactive straight from its own `stop` flag — this alone is what a
   *    fixed-interval loop lives on: CronCreate fires once, and no turn ever needs to revisit it;
   *  - for a self-paced loop (no interval) specifically, a `turn.done` that was not preceded by a
   *    `loop.wake` since the previous `turn.done` (or since the `/loop` message, for the first one) means
   *    he finished a turn without rescheduling himself: the loop died quietly, with nothing to tell it so;
   *  - the exact `LOOP_STOP_MESSAGE` (Sangha's own stop, sent when you stop him before he gets a say) also
   *    ends it, whatever his turns do afterwards.
   * `nextAt` is only ever reported while active (null again once stopped, even if a wake-up had been due).
   *
   * Null: he never got either. `summary()` calls this for every session on every poll, so the scan is
   * narrowed to the three relevant event types with a LIKE prefix match (SQLite's LIKE is ASCII
   * case-insensitive) before the few candidates are parsed and correlated in JS.
   */
  lastAutonomy(sessionId: string): AutonomyState | null {
    const rows = this.db
      .prepare(
        `SELECT ev FROM events WHERE session_id = ? AND (ev LIKE '{"t":"user.message"%' OR ev LIKE '{"t":"loop.wake"%' OR ev LIKE '{"t":"turn.done"%') ORDER BY seq`,
      )
      .all(sessionId) as { ev: string }[]

    let mode: 'goal' | 'loop' | null = null
    let text: string | null = null
    let interval: string | null = null
    let active = false
    let nextAt: number | null = null
    // Whether a loop.wake has happened since the loop was (re)established or since the last turn.done:
    // what tells a self-paced loop's next turn.done whether he rescheduled himself or went quiet.
    let wakeSinceLastTurn = false

    for (const { ev: raw } of rows) {
      const ev = JSON.parse(raw) as MonasteryEvent
      if (ev.t === 'user.message') {
        const trimmed = ev.text.trim()
        if (trimmed === LOOP_STOP_MESSAGE) {
          if (mode === 'loop') active = false
          continue
        }
        // The LIKE above also catches a message that merely starts with "/goal" or "/loop" (e.g.
        // "/goalkeeper"): require the command to end there or be followed by whitespace.
        const goalMatch = /^\/goal(?:\s+([\s\S]*))?$/i.exec(trimmed)
        if (goalMatch) {
          mode = 'goal'
          const arg = goalMatch[1]?.trim() ?? ''
          if (!arg || /^(clear|stop|off|cancel)$/i.test(arg)) active = false
          else {
            text = arg
            active = true
          }
          interval = null
          nextAt = null
          wakeSinceLastTurn = false
          continue
        }
        const loopMatch = /^\/loop(?:\s+([\s\S]*))?$/i.exec(trimmed)
        if (loopMatch) {
          mode = 'loop'
          const arg = loopMatch[1]?.trim() ?? ''
          const withInterval = /^(\d+[smhd])(?:\s+([\s\S]*))?$/.exec(arg)
          interval = withInterval ? withInterval[1]! : null
          text = (withInterval ? withInterval[2] : arg)?.trim() ?? ''
          active = true
          nextAt = null
          wakeSinceLastTurn = false
        }
        continue
      }
      if (ev.t === 'loop.wake') {
        if (mode !== 'loop') continue // stray: only his own tool calls emit this, but stay defensive
        wakeSinceLastTurn = true
        active = !ev.stop
        nextAt = ev.stop ? null : ev.nextAt
        continue
      }
      // ev.t === 'turn.done' (the only other type the query above can return)
      if (mode === 'loop' && interval === null && !wakeSinceLastTurn) active = false
      wakeSinceLastTurn = false
    }

    if (mode === null) return null
    if (mode === 'goal') return text ? { mode, text, active } : null
    return { mode, text: text ?? '', interval, nextAt: active ? nextAt : null, active }
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

  moveLocalProject(name: string, path: string) {
    this.db.prepare('UPDATE local_projects SET path = ? WHERE name = ?').run(path, name)
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

  /** The fresh session a priest moved on to. */
  successor(id: string): string | null {
    const r = this.db.prepare('SELECT next_id FROM successors WHERE session_id = ?').get(id) as { next_id: string } | undefined
    if (r) return r.next_id
    // Renewals made before links were kept: the session of the same project and title created as he left.
    const old = this.getSession(id)
    if (!old?.archivedAt) return null
    const guess = this.db
      .prepare('SELECT id FROM sessions WHERE project = ? AND title = ? AND id != ? AND created_at BETWEEN ? AND ? ORDER BY ABS(created_at - ?) LIMIT 1')
      .get(old.project, old.title, id, old.archivedAt - 5_000, old.archivedAt + 5_000, old.archivedAt) as { id: string } | undefined
    return guess?.id ?? null
  }

  setSuccessor(id: string, next: string) {
    this.db.prepare('INSERT INTO successors (session_id, next_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET next_id = excluded.next_id').run(id, next)
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

  /** Priests set aside in the lotus pond, the courtyard's waiting room (Sangha priests and outside sessions alike). */
  lotusIds(): Set<string> {
    return new Set((this.db.prepare('SELECT session_id AS id FROM lotus').all() as { id: string }[]).map((r) => r.id))
  }

  setLotus(id: string, lotus: boolean) {
    if (lotus) this.db.prepare('INSERT OR IGNORE INTO lotus (session_id) VALUES (?)').run(id)
    else this.db.prepare('DELETE FROM lotus WHERE session_id = ?').run(id)
  }

  /** Free-text notes left on priests, by session id, in a single query for the whole courtyard. */
  notes(): Map<string, string> {
    return new Map((this.db.prepare('SELECT session_id AS id, note FROM notes').all() as { id: string; note: string }[]).map((r) => [r.id, r.note]))
  }

  setSessionNote(id: string, note: string | null) {
    if (note) this.db.prepare('INSERT INTO notes (session_id, note) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET note = excluded.note').run(id, note)
    else this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(id)
  }

  /** Endpoints Claude Code can run on instead of Claude, in the order you added them. */
  providers(): Provider[] {
    return (this.db.prepare('SELECT value FROM providers ORDER BY rowid').all() as { value: string }[]).map((r) => JSON.parse(r.value) as Provider)
  }

  saveProvider(p: Provider) {
    this.db.prepare('INSERT INTO providers (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(p.id, JSON.stringify(p))
  }

  removeProvider(id: string) {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }

  /** Your messages waiting for a priest's turn to end, oldest first. */
  queued(sessionId: string): QueuedMessage[] {
    return this.db.prepare('SELECT id, text, at FROM queued_messages WHERE session_id = ? ORDER BY at').all(sessionId) as QueuedMessage[]
  }

  addQueued(sessionId: string, m: QueuedMessage) {
    this.db.prepare('INSERT INTO queued_messages (id, session_id, text, at) VALUES (?, ?, ?, ?)').run(m.id, sessionId, m.text, m.at)
  }

  /** False when it already left (sent meanwhile). */
  editQueued(sessionId: string, id: string, text: string): boolean {
    return this.db.prepare('UPDATE queued_messages SET text = ? WHERE id = ? AND session_id = ?').run(text, id, sessionId).changes > 0
  }

  /** Takes messages out of the queue (sent, or withdrawn by you); returns those that were still there. */
  takeQueued(sessionId: string, ids?: string[]): QueuedMessage[] {
    const all = this.queued(sessionId)
    const taken = ids ? all.filter((m) => ids.includes(m.id)) : all
    const del = this.db.prepare('DELETE FROM queued_messages WHERE id = ?')
    for (const m of taken) del.run(m.id)
    return taken
  }

  /** Standing instructions recalled to priests with each of your messages, by session id. */
  /** A session's own environment variables (empty when none). */
  sessionEnv(id: string): Record<string, string> {
    const r = this.db.prepare('SELECT value FROM session_env WHERE session_id = ?').get(id) as { value: string } | undefined
    return r ? (JSON.parse(r.value) as Record<string, string>) : {}
  }

  setSessionEnv(id: string, env: Record<string, string>) {
    if (Object.keys(env).length) this.db.prepare('INSERT INTO session_env (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value').run(id, JSON.stringify(env))
    else this.db.prepare('DELETE FROM session_env WHERE session_id = ?').run(id)
  }

  /** A Sangha-wide setting (JSON), null when never set. */
  setting<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return r ? (JSON.parse(r.value) as T) : null
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  reminders(): Map<string, string> {
    return new Map((this.db.prepare('SELECT session_id AS id, text FROM reminders').all() as { id: string; text: string }[]).map((r) => [r.id, r.text]))
  }

  setReminder(id: string, text: string | null) {
    if (text) this.db.prepare('INSERT INTO reminders (session_id, text) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET text = excluded.text').run(id, text)
    else this.db.prepare('DELETE FROM reminders WHERE session_id = ?').run(id)
  }

  /** MCP servers you switched on or off for all of Sangha, by name. */
  mcpPrefs(): Record<string, boolean> {
    const rows = this.db.prepare('SELECT name, enabled FROM mcp_global').all() as { name: string; enabled: number }[]
    return Object.fromEntries(rows.map((r) => [r.name, !!r.enabled]))
  }

  setMcpPref(name: string, enabled: boolean) {
    this.db.prepare('INSERT INTO mcp_global (name, enabled) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled').run(name, enabled ? 1 : 0)
  }

  /** A priest's own MCP switches, over the ones of all of Sangha. */
  sessionMcpPrefs(id: string): Record<string, boolean> {
    const rows = this.db.prepare('SELECT name, enabled FROM session_mcp WHERE session_id = ?').all(id) as { name: string; enabled: number }[]
    return Object.fromEntries(rows.map((r) => [r.name, !!r.enabled]))
  }

  /** null: back to the switch of all of Sangha. */
  setSessionMcpPref(id: string, name: string, enabled: boolean | null) {
    if (enabled === null) this.db.prepare('DELETE FROM session_mcp WHERE session_id = ? AND name = ?').run(id, name)
    else
      this.db
        .prepare('INSERT INTO session_mcp (session_id, name, enabled) VALUES (?, ?, ?) ON CONFLICT(session_id, name) DO UPDATE SET enabled = excluded.enabled')
        .run(id, name, enabled ? 1 : 0)
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
  /** Claude Code session id → Sangha session id, for every priest Sangha started. */
  claudeSessionIds(): Map<string, string> {
    const rows = this.db.prepare('SELECT claude_session_id AS claude, id FROM sessions WHERE claude_session_id IS NOT NULL').all() as { claude: string; id: string }[]
    return new Map(rows.map((r) => [r.claude, r.id]))
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

  addFeedback(f: Feedback) {
    this.db
      .prepare('INSERT INTO feedback (id, session_id, event_seq, rating, comment, excerpt, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.id, f.sessionId, f.eventSeq, f.rating, f.comment, f.excerpt, f.createdAt, f.processedAt)
  }

  feedbackForSession(sessionId: string): Feedback[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE session_id = ? ORDER BY created_at').all(sessionId) as FeedbackRow[]).map(toFeedback)
  }

  pendingFeedback(): Feedback[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE processed_at IS NULL ORDER BY created_at').all() as FeedbackRow[]).map(toFeedback)
  }

  markFeedbackProcessed(ids: string[], at: number) {
    const stmt = this.db.prepare('UPDATE feedback SET processed_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(at, id)
  }

  /** Contexte figé pour un retour : le message commenté et ses voisins (ou la fin de la conversation), tronqué. */
  excerptAround(sessionId: string, eventSeq: number | null, maxChars = 1200): string {
    const all = this.events(sessionId)
    const line = (e: Envelope) => (e.ev.t === 'user.message' ? `Toi : ${e.ev.text}` : e.ev.t === 'buddha.text' ? `Lui : ${e.ev.text}` : null)
    const picked =
      eventSeq == null
        ? all.slice(-6)
        : (() => {
            const i = all.findIndex((e) => e.seq === eventSeq)
            return i < 0 ? [] : all.slice(Math.max(0, i - 2), i + 3)
          })()
    const text = picked.map(line).filter((t): t is string => !!t).join('\n\n')
    return text.length > maxChars ? `…${text.slice(-maxChars)}` : text
  }

  elderTopics(): ElderTopic[] {
    return (this.db.prepare('SELECT * FROM elder_topics ORDER BY updated_at DESC').all() as ElderTopicRow[]).map(toTopic)
  }

  elderTopic(id: string): ElderTopic | null {
    const r = this.db.prepare('SELECT * FROM elder_topics WHERE id = ?').get(id) as ElderTopicRow | undefined
    return r ? toTopic(r) : null
  }

  upsertElderTopic(t: ElderTopic) {
    this.db
      .prepare(
        `INSERT INTO elder_topics (id, scope, title, detail, evidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, title = excluded.title, detail = excluded.detail, evidence = excluded.evidence, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(t.id, t.scope, t.title, t.detail, JSON.stringify(t.evidence), t.status, t.createdAt, t.updatedAt)
  }

  elderReports(limit = 10): ElderReport[] {
    return (this.db.prepare('SELECT * FROM elder_reports ORDER BY created_at DESC LIMIT ?').all(limit) as ElderReportRow[]).map(toReport)
  }

  addElderReport(r: ElderReport) {
    this.db
      .prepare('INSERT INTO elder_reports (id, kind, text, topic_ids, cost_usd, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.kind, r.text, JSON.stringify(r.topicIds), r.costUsd, r.tokens, r.createdAt)
  }

  elderChat(limit = 20): ElderChatTurn[] {
    return (this.db.prepare('SELECT * FROM elder_chat ORDER BY id DESC LIMIT ?').all(limit) as ElderChatRow[]).map(toChatTurn).reverse()
  }

  addElderChatMessage(role: 'user' | 'elder', text: string, at: number) {
    this.db.prepare('INSERT INTO elder_chat (role, text, created_at) VALUES (?, ?, ?)').run(role, text, at)
  }

  /** Agrégats pour le bloc « Sangha » du contexte d'Ananda : échecs d'outils MCP, erreurs, interruptions, renouvellements, prêtres confiés à Bouddha, coût total, depuis `since`. */
  elderSanghaStats(since: number): { toolErrorsByServer: Record<string, number>; sessionErrors: number; interruptions: number; renewals: number; shepherded: number; costUsd: number } {
    const rows = this.db
      .prepare(`SELECT session_id, ev FROM events WHERE at >= ? AND (ev LIKE '{"t":"tool.error"%' OR ev LIKE '{"t":"error"%' OR ev LIKE '{"t":"turn.done"%')`)
      .all(since) as { session_id: string; ev: string }[]
    const toolErrorsByServer: Record<string, number> = {}
    let sessionErrors = 0
    let costUsd = 0
    for (const { ev: raw } of rows) {
      const ev = JSON.parse(raw) as MonasteryEvent
      if (ev.t === 'tool.error') toolErrorsByServer[ev.server] = (toolErrorsByServer[ev.server] ?? 0) + 1
      else if (ev.t === 'error') sessionErrors++
      else if (ev.t === 'turn.done') costUsd += ev.costUsdEquiv
    }
    const busySessions = new Set(
      (this.db.prepare(`SELECT DISTINCT session_id FROM events WHERE at >= ? AND ev LIKE '{"t":"busy"%'`).all(since) as { session_id: string }[]).map((r) => r.session_id),
    )
    let interruptions = 0
    for (const id of busySessions) {
      const last = this.lastEvent(id, 'busy')
      if (last && last.ev.busy && last.at >= since) interruptions++
    }
    const renewals = (
      this.db.prepare('SELECT COUNT(*) AS n FROM successors s JOIN sessions sess ON sess.id = s.next_id WHERE sess.created_at >= ?').get(since) as { n: number }
    ).n
    const shepherded = (this.db.prepare('SELECT value FROM shepherds').all() as { value: string }[]).filter((r) => (JSON.parse(r.value) as Shepherd).seenAt >= since).length
    return { toolErrorsByServer, sessionErrors, interruptions, renewals, shepherded, costUsd }
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
  engine: string
  model: string | null
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
  engine: r.engine || 'claude',
  model: r.model,
})

type FeedbackRow = { id: string; session_id: string; event_seq: number | null; rating: string | null; comment: string | null; excerpt: string; created_at: number; processed_at: number | null }
const toFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  sessionId: r.session_id,
  eventSeq: r.event_seq,
  rating: r.rating as Feedback['rating'],
  comment: r.comment,
  excerpt: r.excerpt,
  createdAt: r.created_at,
  processedAt: r.processed_at,
})

type ElderTopicRow = { id: string; scope: string; title: string; detail: string; evidence: string; status: string; created_at: number; updated_at: number }
const toTopic = (r: ElderTopicRow): ElderTopic => ({
  id: r.id,
  scope: r.scope,
  title: r.title,
  detail: r.detail,
  evidence: JSON.parse(r.evidence),
  status: r.status as ElderTopic['status'],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

type ElderReportRow = { id: string; kind: string; text: string; topic_ids: string; cost_usd: number | null; tokens: number | null; created_at: number }
const toReport = (r: ElderReportRow): ElderReport => ({
  id: r.id,
  kind: r.kind as ElderReport['kind'],
  text: r.text,
  topicIds: JSON.parse(r.topic_ids),
  costUsd: r.cost_usd,
  tokens: r.tokens,
  createdAt: r.created_at,
})

type ElderChatRow = { id: number; role: string; text: string; created_at: number }
const toChatTurn = (r: ElderChatRow): ElderChatTurn => ({ id: r.id, role: r.role as ElderChatTurn['role'], text: r.text, createdAt: r.created_at })
