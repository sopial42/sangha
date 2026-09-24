// Buddha shepherding a priest to a fresh session: asked only while he is stopped, at the moment that suits
// him, again and again until he has moved on, unless he refuses outright.

const MIN = 60_000
/** When he gives no delay of his own: ask again later and later, never more than every 2 h. */
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

/** "30 min", "2 h", "1h30", "45 minutes", "une heure": how long he asks for, if he said. */
export function parseDelay(text: string): number | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const hm = /(\d+(?:[.,]\d+)?)\s*h(?:eures?|ours?)?\s*(\d{1,2})?\b/.exec(t)
  if (hm) return Math.round((parseFloat(hm[1]!.replace(',', '.')) * 60 + (hm[2] ? Number(hm[2]) : 0)) * MIN)
  const m = /(\d+)\s*(?:min|mn|minutes?)\b/.exec(t)
  if (m) return Number(m[1]) * MIN
  if (/\b(une|1) heure\b|\ban hour\b/.test(t)) return 60 * MIN
  return null
}

/** His answer, read from its first line. A plain "no" or anything unclear only means "not now". */
export function parseAnswer(answer: string): ShepherdAnswer {
  const text = answer.trim()
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.trim())
  const first = plain(lines[i] ?? '')
  const rest = lines
    .slice(i + 1)
    .join('\n')
    .trim()
  if (/^OUI\b/.test(first)) return { kind: 'yes', handoff: rest || text }
  if (/^NON CATEGORIQUE/.test(first)) return { kind: 'never', reason: rest || text }
  return { kind: 'later', delayMs: parseDelay(lines[i] ?? '') ?? parseDelay(text.slice(0, 400)), reason: text.slice(0, 600) }
}

/** A real handoff: a line of its own titled PASSATION (not the word inside a sentence, e.g. "passation de l'acte"). */
export const isHandoff = (text: string) => /^[\s#*_>«"-]*PASSATION[\s*_»":.-]*$/im.test(text)

/** When to come back: his own estimate (5 min to 12 h), else a growing backoff. */
export function nextDelay(attempts: number, requested: number | null): number {
  if (requested != null) return Math.min(12 * 60 * MIN, Math.max(5 * MIN, requested))
  return BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]! * MIN
}

export function shepherdPrompt(contextK: number, previous: string | null): string {
  return `Bouddha, l'abbé du monastère, te parle. L'utilisateur m'a confié ton départ à neuf : ton contexte pèse environ ${contextK}K tokens, et tu continueras mieux dans une session neuve, avec une passation. Je ne veux pas t'interrompre au mauvais moment : c'est toi qui choisis quand.
${previous ? `\nLa dernière fois, tu m'as répondu : « ${previous.slice(0, 300)} »\n` : ''}
Est-ce un bon moment pour passer la main ? Réponds sur la première ligne par :
- OUI, puis, sous le titre « PASSATION », tout ce dont la nouvelle session aura besoin pour continuer sans toi : l'objectif, les décisions prises, l'état actuel, les prochaines étapes, et les fichiers et pièges importants ;
- PLUS TARD <délai> (par exemple « PLUS TARD 30 min » ou « PLUS TARD 3 h ») si tu as besoin de temps : un sous-agent à attendre, une étape délicate à finir, une longue tâche sensible. Donne une estimation honnête et la raison : je reviendrai à ce moment-là ;
- NON CATÉGORIQUE, seulement si repartir à neuf serait une vraie erreur pour ce travail, avec la raison.

Si tu arrives à un bon moment avant mon retour, n'attends pas ma question : écris « OUI » seul en première ligne, puis le titre « PASSATION » sur sa propre ligne, suivi de la passation.

La fin de la journée n'est pas une raison d'attendre : c'est même le cas où une session neuve est la plus utile, pour reprendre demain l'esprit frais. Avant de répondre OUI, vérifie que ce qui compte pour le projet à long terme est écrit dans les fichiers que le repo prévoit pour ça (README, docs, CLAUDE.md…) ; ajoute seulement ce qui manque vraiment.`
}
