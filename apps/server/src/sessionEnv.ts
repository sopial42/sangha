/**
 * Variables you set for one session: its Claude process starts with them (its Bash commands and its
 * subagents inherit them). A few stay Sangha's own: the API key it never bills, and the git config that
 * carries the commit identity.
 */
export const RESERVED_ENV = ['ANTHROPIC_API_KEY', 'GIT_CONFIG_GLOBAL']

export function checkSessionEnv(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('expected variables: { KEY: "value" }')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`invalid variable name: ${k}`)
    if (RESERVED_ENV.includes(k)) throw new Error(`${k} is reserved for Sangha`)
    if (typeof v !== 'string') throw new Error(`${k}: the value must be text`)
    env[k] = v
  }
  return env
}
