import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import type { GitIdentity } from '@sangha/shared'

/**
 * The name and email every priest commits with, set once for all of Sangha (nothing by default: you
 * must fill it before they may use git). Priests read it from a Git global config of Sangha's own
 * (GIT_CONFIG_GLOBAL), which pulls yours in first (aliases, credentials, signing…) and only overrides
 * your identity. Rewritten on every change, so running priests commit with the new one right away.
 */

export const validIdentity = (v: Partial<GitIdentity> | null | undefined): v is GitIdentity =>
  !!v && typeof v.name === 'string' && !!v.name.trim() && typeof v.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(v.email.trim())

// Inside a double-quoted git config value: backslash and quote escaped, line breaks impossible.
const quoted = (s: string) => `"${s.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Your own global configs, included first so everything but the identity stays yours. */
export function gitConfigText(identity: GitIdentity | null, includes: string[]): string {
  const lines = ['# Written by Sangha: your global git config, with the identity set in Sangha for commits.']
  for (const path of includes) lines.push('[include]', `\tpath = ${quoted(path)}`)
  if (identity) lines.push('[user]', `\tname = ${quoted(identity.name.trim())}`, `\temail = ${quoted(identity.email.trim())}`)
  return `${lines.join('\n')}\n`
}

/** A shell command that runs git (not merely mentions it, as in `cat .gitignore` or `gh pr`). */
export const usesGit = (command: string) => /(^|[\s;&|(`$!{])git(\s|$|;|&|\||\))/.test(command)

export const MISSING_IDENTITY =
  "Git est bloqué : l'identité git des commits n'est pas renseignée dans Sangha. Demande à l'utilisateur de la remplir (bouton « Git » de la page d'accueil de Sangha), puis réessaie. N'essaie pas de contourner ce blocage."

export class GitIdentitySetting {
  readonly path: string

  constructor(
    dataDir: string,
    private read: () => GitIdentity | null,
    private write: (v: GitIdentity) => void,
  ) {
    this.path = join(dataDir, 'gitconfig')
    this.sync()
  }

  get(): GitIdentity | null {
    const v = this.read()
    return validIdentity(v) ? v : null
  }

  set(v: GitIdentity) {
    this.write({ name: v.name.trim(), email: v.email.trim() })
    this.sync()
  }

  /** The environment that makes a priest's git read Sangha's config. */
  env(): Record<string, string> {
    return { GIT_CONFIG_GLOBAL: this.path }
  }

  /** Refuses his git commands (his novices' too) while no identity is set. */
  hooks(): { PreToolUse: HookCallbackMatcher[] } {
    return {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            async (input) => {
              const command = input.hook_event_name === 'PreToolUse' ? (input.tool_input as { command?: unknown })?.command : undefined
              if (this.get() || typeof command !== 'string' || !usesGit(command)) return {}
              return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: MISSING_IDENTITY } }
            },
          ],
        },
      ],
    }
  }

  private sync() {
    const home = homedir()
    const xdg = join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'git', 'config')
    const includes = [xdg, join(home, '.gitconfig')].filter((p) => existsSync(p))
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, gitConfigText(this.get(), includes))
  }
}
