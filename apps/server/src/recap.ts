import { query } from '@anthropic-ai/claude-agent-sdk'
import type { RecapState, SessionRecap } from '@sangha/shared'
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
