import type { SessionStatus, SessionSummary } from '@sangha/shared'
import { openSession } from './api'
import { agentTitle } from './priests'
import { useApp } from './store'

const ATTENTION: SessionStatus[] = ['waiting', 'error']

// Browsers only allow sound after a user gesture: the audio context is created (or resumed) on the
// first click or key in the page, then reused, so a bowl can ring when a session finishes later.
let audio: AudioContext | null = null

function unlockAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

/**
 * A Tibetan singing bowl, synthesized (no audio file): a low fundamental with the bowl's inharmonic
 * partials, each doubled slightly off-pitch so they beat, a soft strike and a long fade.
 */
export function bowl() {
  if (!audio || audio.state !== 'running') return
  const now = audio.currentTime
  const out = audio.createGain()
  out.gain.value = 0.9
  out.connect(audio.destination)
  const fundamental = 196 // G3
  const partials: [ratio: number, gain: number, decay: number][] = [
    [1, 0.22, 7],
    [2.76, 0.09, 5],
    [5.4, 0.04, 3.2],
    [8.93, 0.018, 2],
  ]
  for (const [ratio, gain, decay] of partials) {
    for (const detune of [-1.2, 1.2]) {
      const osc = audio.createOscillator()
      const g = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = fundamental * ratio + detune
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(gain, now + 0.02) // the strike
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      osc.connect(g).connect(out)
      osc.start(now)
      osc.stop(now + decay + 0.1)
    }
  }
}

/** Ask for notification permission on the first user gesture (browsers require one). */
export function requestNotifications() {
  const ask = () => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    window.removeEventListener('pointerdown', ask)
  }
  window.addEventListener('pointerdown', ask)
  // Every gesture keeps the audio unlocked (Safari may suspend it again).
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)
}

/**
 * When a priest opens his eyes (or gets in trouble) while you look elsewhere: ring the bell,
 * show a system notification, and count him in the tab title.
 */
export function watchPriests() {
  let previous: Record<string, SessionStatus> | null = null
  return useApp.subscribe((state) => {
    const { sessions, selectedId, projects } = state
    // Silenced priests (incense out) never call for you.
    const waiting = Object.values(sessions).filter((s) => ATTENTION.includes(s.status) && !s.silenced)
    document.title = waiting.length ? `(${waiting.length}) Sangha` : 'Sangha'

    const now = Object.fromEntries(Object.values(sessions).map((s) => [s.id, s.status]))
    if (previous) {
      const lookingAt = (s: SessionSummary) => s.id === selectedId && document.visibilityState === 'visible'
      const finished = waiting.filter((s) => previous![s.id] && !ATTENTION.includes(previous![s.id]!))
      // The bowl rings for every session that finishes; the system notification only if you look elsewhere.
      if (finished.length) bowl()
      const fresh = finished.filter((s) => !lookingAt(s))
      if (fresh.length) {
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const s of fresh) {
            const who = agentTitle(s, projects)
            const n = new Notification(s.status === 'error' ? `${who} est en difficulté` : `${who} a fini`, {
              body: s.project ? `${s.project} · ${s.title}` : s.title,
              tag: s.id,
            })
            n.onclick = () => {
              window.focus()
              openSession(s.id)
            }
          }
        }
      }
    }
    previous = now
  })
}
