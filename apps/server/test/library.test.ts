import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpLibrary, withEnv } from '../src/library'

const envFile = (text = '') => {
  const path = join(mkdtempSync(join(tmpdir(), 'sangha-lib-')), '.env')
  writeFileSync(path, text)
  return path
}

const creds = { BITBUCKET_MCP_DIR: '/opt/mcp-bitbucket', BITBUCKET_MCP_API_BASE_URL: 'https://stash.example', BITBUCKET_MCP_TOKEN: 's3cret' }

describe('the MCP library', () => {
  it('starts switched off, and asks for credentials it lacks', () => {
    const lib = new McpLibrary(envFile())
    expect(lib.list()[0]).toMatchObject({ name: 'bitbucket-stdio', active: false, missing: true })
    expect(() => lib.set('bitbucket-stdio', { active: true })).toThrow(/il manque/)
    expect(lib.catalog()).toEqual({})
  })

  it('keeps credentials in .env but the switch in memory only', () => {
    const path = envFile('CLAUDE_CODE_OAUTH_TOKEN=abc\nBITBUCKET_MCP_TOKEN=\n')
    const lib = new McpLibrary(path)
    lib.set('bitbucket-stdio', { values: creds, active: true })
    const server = lib.catalog()['bitbucket-stdio']
    expect(server?.scope).toBe('library')
    expect(server?.config).toMatchObject({ type: 'stdio', env: { MCP_TRANSPORT: 'stdio', BITBUCKET_API_BASE_URL: 'https://stash.example', BITBUCKET_TOKEN: 's3cret' } })
    expect(readFileSync(path, 'utf8')).toBe(
      'CLAUDE_CODE_OAUTH_TOKEN=abc\nBITBUCKET_MCP_TOKEN=s3cret\nBITBUCKET_MCP_DIR=/opt/mcp-bitbucket\nBITBUCKET_MCP_API_BASE_URL=https://stash.example\n',
    )

    const restarted = new McpLibrary(path)
    expect(restarted.list()[0]).toMatchObject({ active: false, missing: false })
    restarted.set('bitbucket-stdio', { active: true })
    expect(Object.keys(restarted.catalog())).toEqual(['bitbucket-stdio'])
    restarted.set('bitbucket-stdio', { active: false })
    expect(restarted.catalog()).toEqual({})
  })

  it('never sends a secret back, and keeps it when left blank', () => {
    const path = envFile()
    const lib = new McpLibrary(path)
    lib.set('bitbucket-stdio', { values: creds })
    lib.set('bitbucket-stdio', { values: { ...creds, BITBUCKET_MCP_TOKEN: '' } })
    const token = lib.list()[0]!.fields.find((f) => f.key === 'BITBUCKET_MCP_TOKEN')
    expect(token).toMatchObject({ secret: true, set: true })
    expect(token).not.toHaveProperty('value')
    expect(readFileSync(path, 'utf8')).toContain('BITBUCKET_MCP_TOKEN=s3cret')
  })
})

describe('withEnv', () => {
  it('quotes values that need it', () => {
    expect(withEnv('A=1', { B: 'a b#c' })).toBe('A=1\nB="a b#c"\n')
  })
})
