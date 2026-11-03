import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { HANDOFF_DIR } from './shepherd'
import { UserError } from './session'

const IMAGE = /\.(png|jpe?g|heic|tiff?)$/i
// macOS names them "Capture d’écran 2026-11-03 à 14.30.12.png" (in French) or "Screenshot …" / "Screen Shot …".
const SCREENSHOT = /^(capture d.écran|screenshot|screen shot|bildschirmfoto|captura de pantalla)/i

/** Where macOS saves screenshots: the folder set in the screenshot tool, else the Desktop. */
export function screenshotDir(): string {
  if (process.env.SANGHA_SCREENSHOTS) return process.env.SANGHA_SCREENSHOTS
  try {
    const dir = execFileSync('defaults', ['read', 'com.apple.screencapture', 'location'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (dir) return dir.replace(/^~/, homedir())
  } catch {
    // Never set: the Desktop.
  }
  return join(homedir(), 'Desktop')
}

/** The newest screenshot in `dir` (else its newest image), null when there is none. */
export function latestScreenshot(dir: string): { file: string; at: number } | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM' || (e as NodeJS.ErrnoException).code === 'EACCES')
      throw new UserError(`Sangha n'a pas le droit de lire ${dir} : autorise ton terminal dans Réglages Système › Confidentialité et sécurité › Fichiers et dossiers (Bureau), puis relance make dev.`)
    throw new UserError(`Dossier des captures introuvable : ${dir}`)
  }
  const images = names
    .filter((n) => IMAGE.test(n) && !n.startsWith('.'))
    .map((n) => ({ name: n, file: join(dir, n), at: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  const best = images.find((i) => SCREENSHOT.test(i.name)) ?? images[0]
  return best ? { file: best.file, at: best.at } : null
}

/**
 * The latest screenshot, copied under /tmp/sangha with a plain name: the priest reads it there even when he
 * may not open your Desktop, and its odd characters (macOS puts a narrow space in the time) stay out of the way.
 */
export function attachLatestScreenshot(dir = screenshotDir(), out = join(HANDOFF_DIR, 'captures')): { path: string; at: number } {
  const shot = latestScreenshot(dir)
  if (!shot) throw new UserError(`Aucune capture d'écran dans ${dir}.`)
  mkdirSync(out, { recursive: true })
  const stamp = new Date(shot.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const path = join(out, `capture-${stamp}${extname(shot.file).toLowerCase()}`)
  copyFileSync(shot.file, path)
  return { path, at: shot.at }
}
