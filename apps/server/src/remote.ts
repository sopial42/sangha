import { spawn } from 'node:child_process'

/** The interactive CLI only opens Remote Control on a terminal: a tiny Python pty holds one for it, headless. */
const PTY = `
import fcntl, os, pty, re, select, struct, sys, termios
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
seen, trusted = b'', False
while True:
    try:
        r, _, _ = select.select([fd], [], [], 5)
        data = os.read(fd, 65536) if r else b''
    except OSError:
        break
    if r and not data:
        break
    if data:
        sys.stdout.buffer.write(data)
        sys.stdout.flush()
        if not trusted:
            seen = (seen + re.sub(rb'\\x1b\\[[0-9;?<>=]*[a-zA-Z]|\\s', b'', data))[-4000:]
            if b'Itrustthisfolder' in seen:
                trusted = True
                os.write(fd, b'\\x1b[B\\r')
`

const URL_RE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/
const ANSI = /\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07/g
// Inherited from a Claude process above Sangha, these would turn his transcript saving off.
const CHILD_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT']

export type RemoteControl = { url: string; stop: () => void }

/**
 * Resumes his conversation in an interactive `claude --remote-control` and resolves with the claude.ai/code
 * link once it is up. `onExit` fires when that process ends, whoever stopped it.
 */
export function startRemote(
  cwd: string,
  claudeSessionId: string,
  name: string,
  env: Record<string, string>,
  onExit: () => void,
): Promise<RemoteControl> {
  const childEnv: Record<string, string> = { ...env, TERM: 'xterm-256color' }
  for (const k of CHILD_MARKERS) delete childEnv[k]
  const args = ['--remote-control', name, '--resume', claudeSessionId, '--permission-mode', 'bypassPermissions']
  const proc = spawn('python3', ['-c', PTY, 'claude', ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const stop = () => {
    if (proc.exitCode === null) proc.kill('SIGTERM')
  }
  return new Promise((resolve, reject) => {
    let out = ''
    let url: string | null = null
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`pas de lien Remote Control après 60 s : ${out.replace(ANSI, '').replace(/\s+/g, ' ').slice(-300)}`))
    }, 60_000)
    proc.stdout.on('data', (chunk: Buffer) => {
      if (url) return
      out = (out + chunk.toString()).slice(-20_000)
      const m = out.replace(ANSI, '').replace(/\s+/g, '').match(URL_RE)
      if (m) {
        url = m[0]
        clearTimeout(timer)
        resolve({ url, stop })
      }
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('exit', () => {
      clearTimeout(timer)
      if (url) onExit()
      else reject(new Error(`claude s'est arrêté avant le lien : ${out.replace(ANSI, '').replace(/\s+/g, ' ').slice(-300)}`))
    })
  })
}
