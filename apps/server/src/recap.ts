import { query } from '@anthropic-ai/claude-agent-sdk'
import type { NirvanaSearchResult, RecapState, SessionRecap } from '@sangha/shared'
import { cleanScriptSummary, scriptPrompt } from './scripts'

const RECAP_MODEL = process.env.SANGHA_RECAP_MODEL ?? 'haiku'
const MAX_INPUT = 8000

export type Recap = SessionRecap

const STATES: RecapState[] = ['fini', 'question', 'attente']

const SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'string', description: 'What was achieved, in one complete sentence of at most 70 characters.' },
    next: { type: 'string', description: 'What it is waiting for now (a decision from the user, or something running on its own: CI, deployment, review…) or what is left, in one complete sentence of at most 70 characters.' },
    state: {
      type: 'string',
      enum: STATES,
      description: '"fini": the task is done and it is waiting for nothing. "question": it asks a question or waits for a decision from the user. "attente": it waits for something that runs without the user (CI, deployment, review, computation, another agent).',
    },
  },
  required: ['done', 'next', 'state'],
  additionalProperties: false,
}

const STYLE = `Style: very plain English, for someone who isn't a developer. Talk about the functional result
(what works, what changes for the user or the product), never about the technical side: no file names, branches,
commands, tools, code or jargon. Short, concrete sentences. Always answer in English.`

const SYSTEM = `You summarize for its user the state of an agent's work session, in two very short, complete sentences.
"done" = what was achieved; "next" = what the agent is waiting for now, or what is left.
Read its last message above all: if it is waiting for something that runs without the user (CI, a deployment,
a review, a computation, another agent), say so ("Waiting for CI results before merging"): that is not an
instruction for the user. If it asks a question or waits for a decision, say which one.
Only if everything is done and it waits for nothing: "next" = "Nothing: it is waiting for your next instruction."
"state" classifies this stop: "fini", "question" (even a simple offer like "shall I do it?") or "attente".
Very short user messages ("go on", "continue", "ok") say nothing about the task: rely on the earlier
exchanges.
${STYLE}`

/** One-shot, tool-less, structured call on a small model (still on the plan quota). */
async function ask<T>(system: string, schema: Record<string, unknown>, input: string, maxInput: number): Promise<Partial<T> | null> {
  const env = { ...process.env } as Record<string, string>
  delete env.ANTHROPIC_API_KEY
  const q = query({
    prompt: input.length > maxInput ? '…' + input.slice(-maxInput) : input,
    options: {
      model: RECAP_MODEL,
      systemPrompt: system,
      tools: [],
      settingSources: [],
      plugins: [],
      persistSession: false,
      maxTurns: 3,
      outputFormat: { type: 'json_schema', schema },
      env,
    },
  })
  for await (const m of q) {
    if (m.type !== 'result') continue
    return m.subtype === 'success' ? ((m.structured_output as Partial<T> | undefined) ?? null) : null
  }
  return null
}

/** Two lines written when a session stops: the latest exchange in, what was done and what is left out. */
export async function recap(transcript: string): Promise<Recap | null> {
  const out = await ask<Recap>(SYSTEM, SCHEMA, transcript, MAX_INPUT)
  // Never cut here: the texts are asked short, and shown in full.
  if (typeof out?.done !== 'string' || typeof out.next !== 'string') return null
  const state = STATES.find((s) => s === out.state)
  return { done: out.done.trim(), next: out.next.trim(), ...(state && { state }) }
}

const DOING_SCHEMA = {
  type: 'object',
  properties: { doing: { type: 'string', description: 'What the agent is accomplishing, from the user’s point of view, in one complete sentence of at most 80 characters.' } },
  required: ['doing'],
  additionalProperties: false,
}

const DOING_SYSTEM = `You are watching an agent work. From the request and its latest exchanges, say in the present tense,
in one short complete sentence (80 characters max), what it is accomplishing, from the user's point of view.
Example: "Checking that invoice amounts are correct" rather than "Running the billing module tests".
${STYLE}`

/** What a working session is doing overall, in one short sentence. */
export async function doing(transcript: string): Promise<string | null> {
  const out = await ask<{ doing: string }>(DOING_SYSTEM, DOING_SCHEMA, transcript, 8_000)
  return typeof out?.doing === 'string' ? out.doing.trim() : null
}

export type Progress = { goal: string; state: string; next: string }

const PROGRESS_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'The task requested, in one sentence.' },
    state: { type: 'string', description: 'How far along the work on this task is, in 2 or 3 concrete sentences.' },
    next: { type: 'string', description: 'What is left to do, or what is expected from the user, in one sentence.' },
  },
  required: ['goal', 'state', 'next'],
  additionalProperties: false,
}

const PROGRESS_SYSTEM = `You give its user a progress update on an agent's work session and its helpers.
From the initial request and the session thread, say: the task requested, how far along the work is, and what is
left (or the decision the agent expects from the user).
${STYLE}`

/** The big picture of a whole session: the task asked and how far along it is. */
export async function progress(transcript: string): Promise<Progress | null> {
  const out = await ask<Progress>(PROGRESS_SYSTEM, PROGRESS_SCHEMA, transcript, 14_000)
  return typeof out?.goal === 'string' && typeof out.state === 'string' && typeof out.next === 'string'
    ? { goal: out.goal.trim(), state: out.state.trim(), next: out.next.trim() }
    : null
}

const LIFE_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string', description: 'The whole session, in one or two short sentences: what was asked and what came out of it.' } },
  required: ['summary'],
  additionalProperties: false,
}

const LIFE_SYSTEM = `An agent's session has just been closed. Summarize its whole session for its user, in one
or two short, complete sentences: what was asked, and what came out of it.
${STYLE}`

/** Whole-life summary of a session, written once it is closed. */
export async function lifeSummary(transcript: string): Promise<string | null> {
  const out = await ask<{ summary: string }>(LIFE_SYSTEM, LIFE_SCHEMA, transcript, 12_000)
  return typeof out?.summary === 'string' ? out.summary.trim() : null
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'What this script does, in one very short sentence (12 words max), with no jargon or command syntax.',
    },
  },
  required: ['summary'],
  additionalProperties: false,
}

const SCRIPT_SYSTEM = `An agent started a script in the background, which it often waits on. Say in one very short
sentence (12 words max) what it does, and why it matters if that is clear. Never the command itself, never a file
name, flag or technical jargon. Examples: "Runs the client folder's end-to-end tests",
"Waits for the local Docker stack to start", "Watches CI on PR #579".
${STYLE}`

/** One short sentence on what a background script does, written by a small model. */
export async function scriptSummary(command: string, title: string): Promise<string | null> {
  const out = await ask<{ summary: string }>(SCRIPT_SYSTEM, SCRIPT_SCHEMA, scriptPrompt(command, title), 2_000)
  return typeof out?.summary === 'string' ? cleanScriptSummary(out.summary) : null
}

/** One closed session, as fed to the model: enough to judge whether it answers the question. */
export type NirvanaSearchEntry = {
  id: string
  /** archivedAt, "YYYY-MM-DD". */
  date: string
  project: string
  branch: string | null
  agent: string
  note: string | null
  /** The user's first message, already truncated. */
  title: string
  summary: string | null
}

const NIRVANA_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reason: { type: 'string', description: 'One short sentence in English saying why this session answers the question.' },
        },
        required: ['id', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
}

const NIRVANA_SEARCH_SYSTEM = `You search a list of a user's past agent sessions (closed ones, kept in Sangha) to answer
one of their questions. Each line below is one session: its id, the date it was closed, the project and git branch
it worked on, which agent ran it, the user's own short note about it if they left one, its title (their first
message, truncated) and a one- or two-sentence summary of what happened in it.
Pick the sessions that best answer the question, best match first, at most 15; skip anything irrelevant. Only use
ids that appear below: never invent one.
Answer with strict JSON only: {"results":[{"id":"...","reason":"..."}]}.
Write every "reason" as one short sentence in English explaining why that session matches.`

function nirvanaSearchLine(e: NirvanaSearchEntry): string {
  return `id=${e.id} date=${e.date} project=${e.project} branch=${e.branch ?? '-'} agent=${e.agent} note=${e.note ?? '-'} title=${e.title} summary=${e.summary ?? '-'}`
}

/** The model's whole input: one compact line per entry, then the question, in that order, so a
 * truncation from the tail (see `ask`) drops the oldest entries rather than the question itself. */
export function buildNirvanaSearchPrompt(entries: NirvanaSearchEntry[], question: string): string {
  return [...entries.map(nirvanaSearchLine), '', `QUESTION: ${question}`].join('\n')
}

/** The model's raw answer, filtered down to known ids, well-shaped entries, at most 15, order kept. */
export function parseNirvanaSearchResult(raw: unknown, validIds: Set<string>): NirvanaSearchResult {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : []
  const results = list
    .filter((r): r is { id: string; reason: string } => {
      const rec = r as Record<string, unknown> | null
      return !!rec && typeof rec === 'object' && typeof rec.id === 'string' && typeof rec.reason === 'string'
    })
    .filter((r) => validIds.has(r.id))
    .slice(0, 15)
  return { results }
}

/** Which closed sessions best answer a question, best first: a small model reads a compact line per session. */
export async function nirvanaSearch(entries: NirvanaSearchEntry[], question: string): Promise<NirvanaSearchResult> {
  const prompt = buildNirvanaSearchPrompt(entries, question)
  const out = await ask<{ results: unknown }>(NIRVANA_SEARCH_SYSTEM, NIRVANA_SEARCH_SCHEMA, prompt, 40_000)
  return parseNirvanaSearchResult(out, new Set(entries.map((e) => e.id)))
}

/** One worktree left on disk, as fed to the model: enough to judge what it was for and whether it still matters. */
export type WorktreeCommentInput = { path: string; name: string; branch: string | null; commits: string[]; dirty: number; unpushed: number; owner: string | null }

const WORKTREE_COMMENT_SCHEMA = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          comment: { type: 'string', description: 'A comment in English, one or two short sentences: what this worktree is, and whether it looks finished or merged.' },
        },
        required: ['path', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['comments'],
  additionalProperties: false,
}

const WORKTREE_COMMENT_SYSTEM = `You are looking at a list of git worktrees (working copies) left on a user's disk.
For each one you get its path, its branch, its last three commits, whether it has uncommitted changes or commits
never pushed, and the session (agent) that created it when known.
For each one, write a comment ("comment") of one or two short sentences in English: what this worktree is
(what it was used for, from its commits) and whether it looks finished or merged, or still worth keeping.
${STYLE}
Answer with strict JSON: {"comments":[{"path":"...","comment":"..."}]}. Never invent a path: only use
the ones given below.`

function worktreeCommentLine(e: WorktreeCommentInput): string {
  return `path=${e.path} branch=${e.branch ?? '-'} commits=${e.commits.join(' | ') || '-'} dirty=${e.dirty} unpushed=${e.unpushed} session=${e.owner ?? '-'}`
}

/** The model's whole input: one compact line per worktree. */
export function buildWorktreeCommentsPrompt(entries: WorktreeCommentInput[]): string {
  return entries.map(worktreeCommentLine).join('\n')
}

/** The model's raw answer, filtered down to known paths, well-shaped entries, keyed by path. */
export function parseWorktreeComments(raw: unknown, validPaths: Set<string>): Record<string, string> {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { comments?: unknown }).comments) ? (raw as { comments: unknown[] }).comments : []
  const map: Record<string, string> = {}
  for (const c of list) {
    const rec = c as Record<string, unknown> | null
    if (rec && typeof rec === 'object' && typeof rec.path === 'string' && typeof rec.comment === 'string' && validPaths.has(rec.path)) map[rec.path] = rec.comment.trim()
  }
  return map
}

/** One batched call for every worktree given: {path: comment} in English, filtered against the paths asked about. */
export async function worktreeComments(entries: WorktreeCommentInput[]): Promise<Record<string, string>> {
  if (!entries.length) return {}
  const out = await ask<{ comments: unknown }>(WORKTREE_COMMENT_SYSTEM, WORKTREE_COMMENT_SCHEMA, buildWorktreeCommentsPrompt(entries), 20_000)
  return parseWorktreeComments(out, new Set(entries.map((e) => e.path)))
}
