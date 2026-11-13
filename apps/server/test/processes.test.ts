import { describe, expect, it } from 'vitest'
import { claudeAncestor, isClaude, launcherFromEnv, parseProcs, sessionIdOf } from '../src/processes'

const LEAD = 'd78d57f4-01ec-4669-94ab-e41169c267e4'

// A Sangha session (SDK process), the shell of its background task, and the headless team lead it runs.
const ps = `
    1     0 /sbin/launchd
98503  9000 /Users/axel/sangha/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude --output-format stream-json --agent kiat-team-lead --resume=${LEAD} --setting-sources=user,project
30608 98503 /bin/zsh -c source snapshot.sh && claude --agent kiat-team-lead -p hello
30619 30608 claude --agent kiat-team-lead --permission-mode bypassPermissions -p Read /tmp/tl-brief.md first
14960   800 claude --dangerously-skip-permissions
`

describe('processes', () => {
  const procs = parseProcs(ps)

  it('parses pid, ppid and the full command', () => {
    expect(procs.get(30619)).toEqual({ pid: 30619, ppid: 30608, command: "claude --agent kiat-team-lead --permission-mode bypassPermissions -p Read /tmp/tl-brief.md first" })
    expect(procs.size).toBe(5)
  })

  it('recognizes claude binaries by their basename only', () => {
    expect(isClaude(procs.get(98503)!.command)).toBe(true)
    expect(isClaude(procs.get(30619)!.command)).toBe(true)
    expect(isClaude(procs.get(30608)!.command)).toBe(false)
  })

  it('reads the session id from --resume=, --resume, -r and --session-id', () => {
    expect(sessionIdOf(procs.get(98503)!.command)).toBe(LEAD)
    expect(sessionIdOf(`claude --resume ${LEAD}`)).toBe(LEAD)
    expect(sessionIdOf(`claude -r ${LEAD}`)).toBe(LEAD)
    expect(sessionIdOf(`claude --session-id=${LEAD} -p x`)).toBe(LEAD)
    expect(sessionIdOf('claude --resume not-a-uuid')).toBeNull()
    expect(sessionIdOf('claude -p hi')).toBeNull()
  })

  it('finds the claude process that launched a headless one, through its shell', () => {
    expect(claudeAncestor(30619, procs)?.pid).toBe(98503)
    expect(claudeAncestor(98503, procs)).toBeNull()
    expect(claudeAncestor(14960, procs)).toBeNull()
  })

  it('survives a cycle in the process table', () => {
    const loop = parseProcs('10 11 zsh\n11 10 zsh\n')
    expect(claudeAncestor(10, loop)).toBeNull()
  })
})

describe('launcherFromEnv', () => {
  it('reads the launching session from ps eww output or /proc environ', () => {
    expect(launcherFromEnv(`claude -p hi PATH=/bin CLAUDE_CODE_SESSION_ID=${LEAD} CLAUDECODE=1`)).toBe(LEAD)
    expect(launcherFromEnv(`PATH=/bin\0CLAUDE_CODE_SESSION_ID=${LEAD}\0`)).toBe(LEAD)
  })
  it('ignores a missing or malformed id', () => {
    expect(launcherFromEnv('claude PATH=/bin')).toBeNull()
    expect(launcherFromEnv('XCLAUDE_CODE_SESSION_ID=' + LEAD)).toBeNull()
    expect(launcherFromEnv(`CLAUDE_CODE_SESSION_ID=${LEAD}x`)).toBeNull()
  })
})
