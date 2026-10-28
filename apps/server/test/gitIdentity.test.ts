import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitIdentity } from '@sangha/shared'
import { GitIdentitySetting, gitConfigText, MISSING_IDENTITY, usesGit, validIdentity } from '../src/gitIdentity'

describe('git identity', () => {
  it('needs a name and a plausible email', () => {
    expect(validIdentity({ name: 'Axel', email: 'a@b.c' })).toBe(true)
    expect(validIdentity({ name: ' ', email: 'a@b.c' })).toBe(false)
    expect(validIdentity({ name: 'Axel', email: 'pas un email' })).toBe(false)
    expect(validIdentity(null)).toBe(false)
  })

  it('tells a git command from a mere mention of git', () => {
    for (const c of ['git commit -m x', 'cd repo && git push', 'ls; git status', '(git log)', 'echo $(git rev-parse HEAD)', 'FOO=1 git add .'])
      expect(usesGit(c), c).toBe(true)
    for (const c of ['cat .gitignore', 'gh pr list', 'ls .git/', 'npm i legit', 'grep -r digit src']) expect(usesGit(c), c).toBe(false)
  })

  it('writes a config git really reads: yours first, then the identity, quotes escaped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sangha-git-'))
    const mine = join(dir, 'mine')
    writeFileSync(mine, '[user]\n\tname = Old\n\temail = old@x.y\n[alias]\n\tst = status\n')
    const cfg = join(dir, 'cfg')
    writeFileSync(cfg, gitConfigText({ name: 'Axel "A" Dhondt', email: 'axel@ovh.com' }, [mine]))
    // A plain lookup, as git does when committing (it follows includes; `--global` alone would not).
    const git = (key: string) => execFileSync('git', ['config', key], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim()
    expect(git('user.name')).toBe('Axel "A" Dhondt')
    expect(git('user.email')).toBe('axel@ovh.com')
    expect(git('alias.st')).toBe('status')
  })

  it('denies git until an identity is set, and rewrites the config when it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sangha-git-'))
    let stored: GitIdentity | null = null
    const s = new GitIdentitySetting(dir, () => stored, (v) => (stored = v))
    const hook = s.hooks().PreToolUse[0]!.hooks[0]!
    const ask = (command: string) =>
      hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 't', session_id: 's', transcript_path: '', cwd: dir }, 't', { signal: new AbortController().signal })
    expect(await ask('git commit -m x')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: MISSING_IDENTITY } })
    expect(await ask('ls')).toEqual({})
    expect(readFileSync(s.path, 'utf8')).not.toContain('[user]')
    s.set({ name: ' Axel Dhondt ', email: 'axel.dhondt@ovhcloud.com ' })
    expect(await ask('git commit -m x')).toEqual({})
    expect(readFileSync(s.path, 'utf8')).toContain('name = "Axel Dhondt"')
    expect(s.env()).toEqual({ GIT_CONFIG_GLOBAL: s.path })
  })
})
