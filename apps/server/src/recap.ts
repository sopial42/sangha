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
    done: { type: 'string', description: 'Ce qui a été obtenu, en une phrase complète de 70 caractères maximum.' },
    next: { type: 'string', description: 'Ce qu’il attend maintenant (une décision de l’utilisateur, ou quelque chose qui tourne seul : CI, déploiement, revue…) ou ce qui reste, en une phrase complète de 70 caractères maximum.' },
    state: {
      type: 'string',
      enum: STATES,
      description: '"fini" : la tâche est faite, il n’attend rien. "question" : il pose une question ou attend une décision de l’utilisateur. "attente" : il attend quelque chose qui tourne sans l’utilisateur (CI, déploiement, revue, calcul, autre agent).',
    },
  },
  required: ['done', 'next', 'state'],
  additionalProperties: false,
}

const STYLE = `Style : français très simple, pour quelqu'un qui n'est pas développeur. Parle du résultat fonctionnel
(ce qui marche, ce qui change pour l'utilisateur ou le produit), jamais de la technique : pas de noms de fichiers,
de branches, de commandes, d'outils, de code ni de jargon. Phrases courtes et concrètes.`

const SYSTEM = `Tu résumes pour son utilisateur l'état d'une session de travail d'un agent, en deux phrases très courtes et complètes.
"done" = ce qui a été obtenu ; "next" = ce que l'agent attend maintenant, ou ce qui reste.
Lis surtout son dernier message : s'il attend quelque chose qui tourne sans l'utilisateur (la CI, un déploiement,
une revue, un calcul, un autre agent), dis-le ("Attend le résultat de la CI pour fusionner") : ce n'est pas une
consigne de l'utilisateur. S'il pose une question ou attend une décision, dis laquelle.
Seulement si tout est fini et qu'il n'attend rien : "next" = "Rien : il attend ta prochaine consigne."
"state" classe cet arrêt : "fini", "question" (même une simple proposition « je le fais ? ») ou "attente".
Les messages très courts de l'utilisateur ("reprends", "continue", "ok") ne disent rien de la tâche : appuie-toi sur
les échanges d'avant.
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

/** Two lines written when a priest stops: the latest exchange in, what was done and what is left out. */
export async function recap(transcript: string): Promise<Recap | null> {
  const out = await ask<Recap>(SYSTEM, SCHEMA, transcript, MAX_INPUT)
  // Never cut here: the texts are asked short, and shown in full.
  if (typeof out?.done !== 'string' || typeof out.next !== 'string') return null
  const state = STATES.find((s) => s === out.state)
  return { done: out.done.trim(), next: out.next.trim(), ...(state && { state }) }
}

const DOING_SCHEMA = {
  type: 'object',
  properties: { doing: { type: 'string', description: 'Ce que l’agent est en train d’accomplir, vu de l’utilisateur, en une phrase complète de 80 caractères maximum.' } },
  required: ['doing'],
  additionalProperties: false,
}

const DOING_SYSTEM = `Tu regardes travailler un agent. À partir de la demande et de ses derniers échanges, dis au présent,
en une phrase complète et courte (80 caractères max), ce qu'il est en train d'accomplir, vu de l'utilisateur.
Exemple : "Vérifie que les montants des factures sont justes" plutôt que "Lance les tests du module billing".
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
    goal: { type: 'string', description: 'La tâche demandée, en une phrase.' },
    state: { type: 'string', description: 'Où en est le travail sur cette tâche, en 2 ou 3 phrases concrètes.' },
    next: { type: 'string', description: 'Ce qui reste à faire, ou ce qui est attendu de l’utilisateur, en une phrase.' },
  },
  required: ['goal', 'state', 'next'],
  additionalProperties: false,
}

const PROGRESS_SYSTEM = `Tu fais le point, pour son utilisateur, sur une session de travail d'un agent et de ses aides.
À partir de la demande initiale et du fil de la session, dis : la tâche demandée, où en est le travail, et ce qui
reste (ou la décision que l'agent attend de l'utilisateur).
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
  properties: { summary: { type: 'string', description: 'La session entière, en une ou deux phrases courtes : ce qui a été demandé et ce qui en est sorti.' } },
  required: ['summary'],
  additionalProperties: false,
}

const LIFE_SYSTEM = `Un agent vient d'être envoyé au nirvana (sa session est terminée). Résume toute sa session pour
son utilisateur, en une ou deux phrases courtes et complètes : ce qui a été demandé, et ce qui en est sorti.
${STYLE}`

/** Whole-life summary of a session, written once it is sent to nirvana (dismissed). */
export async function lifeSummary(transcript: string): Promise<string | null> {
  const out = await ask<{ summary: string }>(LIFE_SYSTEM, LIFE_SCHEMA, transcript, 12_000)
  return typeof out?.summary === 'string' ? out.summary.trim() : null
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Ce que fait ce script, en une phrase très courte (12 mots maximum), sans jargon ni syntaxe de commande.',
    },
  },
  required: ['summary'],
  additionalProperties: false,
}

const SCRIPT_SYSTEM = `Un agent a lancé un script en arrière-plan, qu'il attend souvent. Dis en une phrase très courte
(12 mots maximum) ce qu'il fait, et pourquoi c'est important si cela se voit. Jamais la commande elle-même, jamais
de nom de fichier, de flag ni de jargon technique. Exemples : « Lance les tests e2e du dossier client »,
« Attend que la stack Docker locale démarre », « Surveille la CI de la PR #579 ».
${STYLE}`

/** One short French sentence on what a background script does, written by a small model. */
export async function scriptSummary(command: string, title: string): Promise<string | null> {
  const out = await ask<{ summary: string }>(SCRIPT_SYSTEM, SCRIPT_SCHEMA, scriptPrompt(command, title), 2_000)
  return typeof out?.summary === 'string' ? cleanScriptSummary(out.summary) : null
}

/** One nirvana entry, as fed to the model: enough to judge whether it answers the question. */
export type NirvanaSearchEntry = {
  id: string
  /** archivedAt, "YYYY-MM-DD". */
  date: string
  project: string
  branch: string | null
  agent: string
  note: string | null
  /** His first message, already truncated. */
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
          reason: { type: 'string', description: 'One short sentence in French saying why this session answers the question.' },
        },
        required: ['id', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
}

const NIRVANA_SEARCH_SYSTEM = `You search a list of a user's past agent sessions (dismissed ones, kept in Sangha's
"nirvana") to answer a question of his. Each line below is one session: its id, the date it was dismissed, the
project and git branch it worked on, which agent ran it, the user's own short note about it if he left one, its
title (his first message, truncated) and a one- or two-sentence summary of what happened in it.
Pick the sessions that best answer the question, best match first, at most 15; skip anything irrelevant. Only use
ids that appear below: never invent one.
Answer with strict JSON only: {"results":[{"id":"...","reason":"..."}]}.
Write every "reason" as one short sentence in French explaining why that session matches — in French even though
everything else here is in English.`

function nirvanaSearchLine(e: NirvanaSearchEntry): string {
  return `id=${e.id} date=${e.date} project=${e.project} branch=${e.branch ?? '-'} agent=${e.agent} note=${e.note ?? '-'} title=${e.title} summary=${e.summary ?? '-'}`
}

/** The model's whole input: one compact line per entry, then the question — in that order, so a
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

/** Which past (nirvana) sessions best answer a question, best first — a small model reads a compact line per session. */
export async function nirvanaSearch(entries: NirvanaSearchEntry[], question: string): Promise<NirvanaSearchResult> {
  const prompt = buildNirvanaSearchPrompt(entries, question)
  const out = await ask<{ results: unknown }>(NIRVANA_SEARCH_SYSTEM, NIRVANA_SEARCH_SCHEMA, prompt, 40_000)
  return parseNirvanaSearchResult(out, new Set(entries.map((e) => e.id)))
}
