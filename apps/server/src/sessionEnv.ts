/**
 * Variables you set for one session: his Claude process starts with them (his Bash commands and his
 * novices inherit them). A few stay Sangha's own: the API key it never bills, and the git config that
 * carries the commit identity.
 */
export const RESERVED_ENV = ['ANTHROPIC_API_KEY', 'GIT_CONFIG_GLOBAL']

export function checkSessionEnv(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('variables attendues : { CLÉ: "valeur" }')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`nom de variable invalide : ${k}`)
    if (RESERVED_ENV.includes(k)) throw new Error(`${k} est réservée à Sangha`)
    if (typeof v !== 'string') throw new Error(`${k} : la valeur doit être du texte`)
    env[k] = v
  }
  return env
}
