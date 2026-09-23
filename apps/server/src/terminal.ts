import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type Delivery = 'tmux' | 'iterm2'

/** The terminal device of a process, e.g. /dev/ttys004. */
async function ttyOf(pid: number): Promise<string | null> {
  try {
    const { stdout } = await exec('ps', ['-o', 'tty=', '-p', String(pid)])
    const tty = stdout.trim()
    return tty && tty !== '??' ? `/dev/${tty.replace(/^\/dev\//, '')}` : null
  } catch {
    return null
  }
}

async function viaTmux(tty: string, text: string): Promise<boolean> {
  try {
    const { stdout } = await exec('tmux', ['list-panes', '-a', '-F', '#{pane_id} #{pane_tty}'])
    const pane = stdout
      .split('\n')
      .map((l) => l.split(' '))
      .find(([, t]) => t === tty)?.[0]
    if (!pane) return false
    await exec('tmux', ['send-keys', '-t', pane, '-l', text])
    await exec('tmux', ['send-keys', '-t', pane, 'Enter'])
    return true
  } catch {
    return false
  }
}

// AppleScript string literal.
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Type into the iTerm2 session whose tty matches, like you would. `dryRun` only checks it exists. */
async function viaITerm(tty: string, text: string, dryRun = false): Promise<boolean> {
  const script = `
if application "iTerm2" is not running then return "none"
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is ${quote(tty)} then
          ${dryRun ? '' : `tell s to write text ${quote(text)}`}
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "none"`
  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 15_000 })
    return stdout.trim() === 'ok'
  } catch {
    return false
  }
}

/**
 * Send your reply to a Claude Code session running in a terminal, typed into its own tab.
 * Newlines would submit early, so a multi-line reply is sent as one line.
 */
export async function typeInto(pid: number, text: string): Promise<Delivery | null> {
  const tty = await ttyOf(pid)
  if (!tty) return null
  const line = text.replace(/\s*\n+\s*/g, ' ').trim()
  if (await viaTmux(tty, line)) return 'tmux'
  if (process.platform === 'darwin' && (await viaITerm(tty, line))) return 'iterm2'
  return null
}

/** Whether a reply could reach this process's terminal, without sending anything. */
export async function reachable(pid: number): Promise<Delivery | null> {
  const tty = await ttyOf(pid)
  if (!tty) return null
  try {
    const { stdout } = await exec('tmux', ['list-panes', '-a', '-F', '#{pane_tty}'])
    if (stdout.split('\n').includes(tty)) return 'tmux'
  } catch {
    // no tmux server
  }
  if (process.platform === 'darwin' && (await viaITerm(tty, '', true))) return 'iterm2'
  return null
}
