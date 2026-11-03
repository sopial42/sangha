import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attachLatestScreenshot, latestScreenshot } from '../src/screenshot'

function desk(files: [string, number][]) {
  const dir = mkdtempSync(join(tmpdir(), 'desk-'))
  for (const [name, at] of files) {
    writeFileSync(join(dir, name), name)
    utimesSync(join(dir, name), at, at)
  }
  return dir
}

describe('latestScreenshot', () => {
  it('takes the newest screenshot, not a newer other image', () => {
    const dir = desk([
      ['Capture d’écran 2026-11-03 à 14.30.12.png', 1000],
      ['Capture d’écran 2026-11-03 à 14.40.00.png', 2000],
      ['diagram.png', 3000],
      ['notes.txt', 4000],
    ])
    expect(latestScreenshot(dir)?.file).toBe(join(dir, 'Capture d’écran 2026-11-03 à 14.40.00.png'))
  })

  it('falls back on the newest image, and says when there is none', () => {
    expect(latestScreenshot(desk([['a.jpg', 1000], ['b.png', 2000]]))?.file).toMatch(/b\.png$/)
    expect(latestScreenshot(desk([['notes.txt', 1000]]))).toBeNull()
  })

  it('copies it under a plain name', () => {
    const dir = desk([['Screenshot 2026-11-03 at 14.30.12.png', 1000]])
    const out = mkdtempSync(join(tmpdir(), 'out-'))
    const { path } = attachLatestScreenshot(dir, out)
    expect(path).toMatch(/capture-1970-01-01-00-16-40\.png$/)
    expect(readFileSync(path, 'utf8')).toBe('Screenshot 2026-11-03 at 14.30.12.png')
  })
})
