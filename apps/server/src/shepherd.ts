import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The orchestrator handing a session off to a fresh session: it is asked only while stopped, at the moment that
// suits it, again and again until it has moved on, unless it refuses outright.
// The session answers YES, LATER or NEVER (older sessions may still answer in French: OUI, PLUS TARD,
// NON CATEGORIQUE), and titles its hand-off HANDOFF (or PASSATION). Both vocabularies are accepted.

const MIN = 60_000
/** When the session gives no delay of its own: ask again later and later, never more than every 2 h. */
const BACKOFF_MIN = [10, 20, 40, 60, 90, 120]

export type ShepherdAnswer =
  | { kind: 'yes'; handoff: string }
  | { kind: 'later'; delayMs: number | null; reason: string }
  | { kind: 'never'; reason: string }

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** "30 min", "2 h", "1h30", "45 minutes", "an hour" (or the French "une heure"): how long it asks for, if it said. */
export function parseDelay(text: string): number | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const hm = /(\d+(?:[.,]\d+)?)\s*h(?:eures?|ours?)?\s*(\d{1,2})?\b/.exec(t)
  if (hm) return Math.round((parseFloat(hm[1]!.replace(',', '.')) * 60 + (hm[2] ? Number(hm[2]) : 0)) * MIN)
  const m = /(\d+)\s*(?:min|mn|minutes?)\b/.exec(t)
  if (m) return Number(m[1]) * MIN
  if (/\b(une|1) heure\b|\ban hour\b/.test(t)) return 60 * MIN
  return null
}

/** Its answer, read from the first line. A plain "no" or anything unclear only means "not now". */
export function parseAnswer(answer: string): ShepherdAnswer {
  const text = answer.trim()
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.trim())
  const first = plain(lines[i] ?? '')
  const rest = lines
    .slice(i + 1)
    .join('\n')
    .trim()
  if (/^(YES|OUI)\b/.test(first)) return { kind: 'yes', handoff: rest || text }
  if (/^(NEVER|NON CATEGORIQUE)\b/.test(first)) return { kind: 'never', reason: rest || text }
  return { kind: 'later', delayMs: parseDelay(lines[i] ?? '') ?? parseDelay(text.slice(0, 400)), reason: text.slice(0, 600) }
}

const firstLine = (m: string) => plain(m.split('\n').find((l) => l.trim()) ?? '')

/**
 * Its answer across the messages it wrote since the question. It often says something first ("before
 * answering, I check the docs…"): the answer is its last message that opens on YES, NO, LATER or NEVER (or
 * their French forms), with everything after it (the hand-off may run over several messages).
 */
export function readDecision(messages: string[]): ShepherdAnswer {
  const i = messages.findLastIndex((m) => /^(YES|NO|LATER|NEVER|OUI|NON|PLUS TARD)\b/.test(firstLine(m)))
  return parseAnswer((i >= 0 ? messages.slice(i) : messages).join('\n\n'))
}

/** A real hand-off: a line of its own titled HANDOFF or PASSATION (not the word inside a sentence, e.g. "the handoff went fine"). */
export const isHandoff = (text: string) => /^[\s#*_>«"-]*(HAND[- ]?OFF|PASSATION)[\s*_»":.-]*$/im.test(text)

/** When to come back: its own estimate (5 min to 12 h), else a growing backoff. */
export function nextDelay(attempts: number, requested: number | null): number {
  if (requested != null) return Math.min(12 * 60 * MIN, Math.max(5 * MIN, requested))
  return BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]! * MIN
}

export function shepherdPrompt(contextK: number, previous: string | null): string {
  return `This is the Sangha orchestrator. The user asked me to move you to a fresh session: your context weighs about ${contextK}K tokens, and you will do better in a new session, with a hand-off. I don't want to interrupt you at a bad moment, so you choose when.
${previous ? `\nLast time, you answered: "${previous.slice(0, 300)}"\n` : ''}
Is this a good moment to hand over? Answer on the first line with:
- YES, then, under the heading "HANDOFF", everything the new session will need to continue without you: the goal, the decisions made, the current state, the next steps, and the important files and pitfalls;
- LATER <delay> (for example "LATER 30 min" or "LATER 3 h") if you need time: a subagent to wait for, a delicate step to finish, a long sensitive task. Give an honest estimate and the reason, and I will come back then;
- NEVER, only if starting fresh would be a real mistake for this work, with the reason.

If you reach a good moment before I come back, don't wait for my question: write "YES" alone on the first line, then the heading "HANDOFF" on its own line, followed by the hand-off.

The end of the day is not a reason to wait: it is actually when a fresh session helps most, to pick up tomorrow with a clear head. Before answering YES, check that what matters for the project in the long run is written in the files the repo has for that (README, docs, CLAUDE.md…), and add only what is truly missing.`
}

/**
 * Context you hand over with the session, too big for a prompt: written to a file under /tmp (the system
 * clears it, nothing to delete), read first by the fresh session, like a skill.
 */
export const HANDOFF_DIR = '/tmp/sangha'

export function writeHandoffContext(sessionId: string, text: string, dir = HANDOFF_DIR): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `handoff-${sessionId.slice(0, 8)}-${Date.now()}.md`)
  writeFileSync(file, text)
  return file
}

/** The fresh session's first message: the hand-off it wrote, and your context file to read before anything. */
export function renewalMessage(handoff: string, contextFile: string | null): string {
  const context =
    contextFile && existsSync(contextFile)
      ? `\n\nBefore anything else, read the whole file ${contextFile}: the user put the context of this hand-off there, too long for a message. Treat it like a skill: it is authoritative, and read it again whenever you need it.`
      : ''
  return `You are picking up work in progress in a fresh session, because the previous one had too heavy a context. Here is the hand-off it wrote for you:\n\n${handoff}${context}\n\nRead it carefully, then continue the work.`
}
