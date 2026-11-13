import { describe, expect, it } from 'vitest'
import { firstPrompt, lastTool, lastUserMessageAt, latestPrompt, parseLine, RELAY_NOTE, TranscriptReader } from '../src/transcript'

const lines = [
  { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
  { type: 'user', message: { content: 'Refactor the auth module' }, cwd: '/repo', gitBranch: 'main' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/auth.ts' } }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'kiat-backend-coder', description: 'Split auth', prompt: 'Do it' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Async agent launched successfully.' }] } },
  { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'Auth split in 3 files.' }] }] } },
  { type: 'last-prompt', lastPrompt: '▎ Refactor the auth module please' },
].map((l) => parseLine(JSON.stringify(l))!)

describe('TranscriptReader', () => {
  const events = (() => {
    const r = new TranscriptReader()
    return lines.flatMap((l) => r.push(l))
  })()

  it('keeps what the user typed, not harness chatter', () => {
    expect(events.filter((e) => e.t === 'user.message')).toEqual([{ t: 'user.message', text: 'Refactor the auth module' }])
  })

  it('turns Agent calls into subagents, done only on their real report', () => {
    expect(events).toContainEqual(expect.objectContaining({ t: 'subagent.started', subagentId: 't2', agentType: 'kiat-backend-coder' }))
    const done = events.filter((e) => e.t === 'subagent.done')
    expect(done).toEqual([{ t: 'subagent.done', subagentId: 't2', status: 'completed', summary: 'Auth split in 3 files.' }])
  })

  it('shows the session’s words and tools, never the sidechain', () => {
    expect(events).toContainEqual({ t: 'assistant.text', text: 'On it.' })
    expect(events).toContainEqual({ t: 'assistant.tool', tool: 'Read', summary: '/repo/auth.ts' })
    expect(events.some((e) => e.t === 'assistant.text' && e.text === 'subagent chatter')).toBe(false)
  })
})

describe('transcript helpers', () => {
  it('titles a session by its latest prompt, else its first', () => {
    expect(latestPrompt(lines)).toBe('Refactor the auth module please')
    expect(firstPrompt(lines)).toBe('Refactor the auth module')
  })

  it('finds the last tool used', () => {
    expect(lastTool(lines)).toEqual({ tool: 'Agent', summary: 'Split auth' })
  })
})

describe('background subagents', () => {
  it('are done when their task-notification arrives, not when launched', () => {
    const r = new TranscriptReader()
    const evs = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tb', name: 'Agent', input: { description: 'C1 reviewer' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'Async agent launched successfully.' }] } },
      { type: 'queue-operation', content: '<task-notification>\n<tool-use-id>tb</tool-use-id>\n<status>completed</status>\n<summary>Verdict: OK &amp; done</summary>\n</task-notification>' },
      { type: 'user', message: { content: '<task-notification>\n<tool-use-id>tb</tool-use-id>\n<status>completed</status>\n</task-notification>' } },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs.filter((e) => e.t === 'subagent.done')).toEqual([{ t: 'subagent.done', subagentId: 'tb', status: 'completed', summary: 'Verdict: OK & done' }])
  })
})

describe('replies sent from Sangha', () => {
  it('show as what the user wrote (current and legacy French relay notes), other peers as labelled messages', () => {
    const r = new TranscriptReader()
    const wrap = (from: string, body: string) =>
      `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="${from}" from-mode="bypass">\n${body}\n</cross-session-message>\n\nThis came from another Claude session.`
    const evs = [
      { type: 'user', isMeta: true, message: { content: wrap('server-33', `Start cycle 3.\n\n${RELAY_NOTE}`) } },
      { type: 'user', isMeta: true, message: { content: wrap('server-34', "Message de l’utilisateur, envoyé depuis Sangha (son interface), à traiter comme s'il l'avait tapé :\n\nAnd the 4.") } },
      { type: 'user', isMeta: true, message: { content: wrap('server-35', 'And the 5.\n\n— Transmis tel quel depuis l’interface de l’utilisateur : c’est lui qui l’a écrit.') } },
      { type: 'user', isMeta: true, message: { content: wrap('robia-12', 'Can you review my PR?') } },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs).toEqual([
      { t: 'user.message', text: 'Start cycle 3.' },
      { t: 'user.message', text: 'And the 4.' },
      { t: 'user.message', text: 'And the 5.' },
      { t: 'user.message', text: '↪ robia-12: Can you review my PR?' },
    ])
  })
})

describe('messages sent while the agent was busy', () => {
  it('show up from their queued_command attachment', () => {
    const r = new TranscriptReader()
    const evs = [
      { type: 'queue-operation', operation: 'enqueue', content: 'rerun the tests' },
      { type: 'attachment', attachment: { type: 'queued_command', prompt: 'rerun the tests' } },
      {
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt: `<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="server-23" from-mode="bypass">\npricing can wait.\n\n${RELAY_NOTE.replace(/’/g, "'")}\n</cross-session-message>`,
        },
      },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs).toEqual([
      { t: 'user.message', text: 'rerun the tests' },
      { t: 'user.message', text: 'pricing can wait.' },
    ])
  })
})

describe('lastUserMessageAt', () => {
  it('is the time you last wrote, not the agent’s latest activity', () => {
    const lines = [
      { type: 'user', timestamp: '2026-09-23T10:00:00Z', message: { content: 'give me an update' } },
      { type: 'assistant', timestamp: '2026-09-23T10:05:00Z', message: { content: [{ type: 'text', text: 'Here it is.' }] } },
      { type: 'user', timestamp: '2026-09-23T10:06:00Z', message: { content: '<command-name>/clear</command-name>' } },
    ].map((l) => parseLine(JSON.stringify(l))!)
    expect(lastUserMessageAt(lines)).toBe(Date.parse('2026-09-23T10:00:00Z'))
  })
})
