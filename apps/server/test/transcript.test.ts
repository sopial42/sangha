import { describe, expect, it } from 'vitest'
import { firstPrompt, lastTool, latestPrompt, parseLine, RELAY_NOTE, TranscriptReader } from '../src/transcript'

const lines = [
  { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
  { type: 'user', message: { content: 'Refactor the auth module' }, cwd: '/repo', gitBranch: 'main' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/auth.ts' } }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'kiat-backend-coder', description: 'Split auth', prompt: 'Do it' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Async agent launched successfully.' }] } },
  { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'novice chatter' }] } },
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

  it('turns Agent calls into novices, done only on their real report', () => {
    expect(events).toContainEqual(expect.objectContaining({ t: 'monk.summoned', monkId: 't2', agentType: 'kiat-backend-coder' }))
    const done = events.filter((e) => e.t === 'monk.done')
    expect(done).toEqual([{ t: 'monk.done', monkId: 't2', status: 'completed', summary: 'Auth split in 3 files.' }])
  })

  it('shows the priest words and tools, never the sidechain', () => {
    expect(events).toContainEqual({ t: 'buddha.text', text: 'On it.' })
    expect(events).toContainEqual({ t: 'buddha.tool', tool: 'Read', summary: '/repo/auth.ts' })
    expect(events.some((e) => e.t === 'buddha.text' && e.text === 'novice chatter')).toBe(false)
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

describe('background novices', () => {
  it('are done when their task-notification arrives, not when launched', () => {
    const r = new TranscriptReader()
    const evs = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tb', name: 'Agent', input: { description: 'C1 reviewer' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'Async agent launched successfully.' }] } },
      { type: 'queue-operation', content: '<task-notification>\n<tool-use-id>tb</tool-use-id>\n<status>completed</status>\n<summary>Verdict: OK &amp; done</summary>\n</task-notification>' },
      { type: 'user', message: { content: '<task-notification>\n<tool-use-id>tb</tool-use-id>\n<status>completed</status>\n</task-notification>' } },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs.filter((e) => e.t === 'monk.done')).toEqual([{ t: 'monk.done', monkId: 'tb', status: 'completed', summary: 'Verdict: OK & done' }])
  })
})

describe('replies sent from Sangha', () => {
  it('show as what the user wrote, other peers as labelled messages', () => {
    const r = new TranscriptReader()
    const wrap = (from: string, body: string) =>
      `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="${from}" from-mode="bypass">\n${body}\n</cross-session-message>\n\nThis came from another Claude session.`
    const evs = [
      { type: 'user', isMeta: true, message: { content: wrap('server-33', `Lance le cycle 3.\n\n${RELAY_NOTE}`) } },
      { type: 'user', isMeta: true, message: { content: wrap('server-34', "Message de l’utilisateur, envoyé depuis Sangha (son interface), à traiter comme s'il l'avait tapé :\n\nEt le 4.") } },
      { type: 'user', isMeta: true, message: { content: wrap('robia-12', 'Peux-tu relire ma PR ?') } },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs).toEqual([
      { t: 'user.message', text: 'Lance le cycle 3.' },
      { t: 'user.message', text: 'Et le 4.' },
      { t: 'user.message', text: '↪ robia-12 : Peux-tu relire ma PR ?' },
    ])
  })
})

describe('messages sent while the agent was busy', () => {
  it('show up from their queued_command attachment', () => {
    const r = new TranscriptReader()
    const evs = [
      { type: 'queue-operation', operation: 'enqueue', content: 'relance les tests' },
      { type: 'attachment', attachment: { type: 'queued_command', prompt: 'relance les tests' } },
      {
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt: `<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="server-23" from-mode="bypass">\nles tarifs, on verra plus tard.\n\n${RELAY_NOTE.replace(/’/g, "'")}\n</cross-session-message>`,
        },
      },
    ].flatMap((l) => r.push(parseLine(JSON.stringify(l))!))
    expect(evs).toEqual([
      { t: 'user.message', text: 'relance les tests' },
      { t: 'user.message', text: 'les tarifs, on verra plus tard.' },
    ])
  })
})
