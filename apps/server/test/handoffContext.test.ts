import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renewalMessage, writeHandoffContext } from '../src/shepherd'

describe('handoff context', () => {
  it('writes your context to a file and the fresh session is told to read it first', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sangha-')), 'sub')
    const file = writeHandoffContext('3114a2df-3e5f', '# Contexte\nTout ce qui compte.', dir)
    expect(file.startsWith(join(dir, 'passation-3114a2df-'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('# Contexte\nTout ce qui compte.')
    const msg = renewalMessage('PASSATION : objectif X', file)
    expect(msg).toContain('PASSATION : objectif X')
    expect(msg).toContain(`lis en entier le fichier ${file}`)
  })

  it('says nothing of a context file there is none of, or that is gone', () => {
    expect(renewalMessage('h', null)).not.toContain('fichier')
    expect(renewalMessage('h', '/tmp/sangha/disparu.md')).not.toContain('fichier')
  })
})
