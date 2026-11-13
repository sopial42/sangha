import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renewalMessage, writeHandoffContext } from '../src/handoff'

describe('handoff context', () => {
  it('writes your context to a file and the fresh session is told to read it first', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sangha-')), 'sub')
    const file = writeHandoffContext('3114a2df-3e5f', '# Context\nEverything that matters.', dir)
    expect(file.startsWith(join(dir, 'handoff-3114a2df-'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('# Context\nEverything that matters.')
    const msg = renewalMessage('HANDOFF: goal X', file)
    expect(msg).toContain('HANDOFF: goal X')
    expect(msg).toContain(`read the whole file ${file}`)
  })

  it('says nothing of a context file there is none of, or that is gone', () => {
    expect(renewalMessage('h', null)).not.toContain('file')
    expect(renewalMessage('h', '/tmp/sangha/gone.md')).not.toContain('file')
  })
})
