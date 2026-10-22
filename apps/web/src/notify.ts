import type { RecapState, SessionStatus, SessionSummary } from '@sangha/shared'
import { agentTitle } from './priests'
import { useApp } from './store'

const ATTENTION: SessionStatus[] = ['waiting', 'error']
/** How long a stop waits for its recap (which says why he stopped) before ringing the plain bowl anyway. */
const RECAP_WAIT_MS = 15_000

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
  strike(196, 0.9, 0) // G3
}

/** One synthesized bowl strike: `fundamental` Hz, `level` volume, `delay` s from now, decays scaled by `length`. */
function strike(fundamental: number, level: number, delay: number, length = 1) {
  if (!audio || audio.state !== 'running') return
  const now = audio.currentTime + delay
  const out = audio.createGain()
  out.gain.value = level
  out.connect(audio.destination)
  const partials: [ratio: number, gain: number, decay: number][] = [
    [1, 0.22, 7 * length],
    [2.76, 0.09, 5 * length],
    [5.4, 0.04, 3.2 * length],
    [8.93, 0.018, 2 * length],
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

/** Every gesture keeps the audio unlocked (browsers allow sound only after one; Safari may suspend it again). */
export function keepAudioUnlocked() {
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)
}

/** A session's recap as a comparable key: a new one means the small model has read this stop. */
const recapKey = (s: SessionSummary) => (s.recap ? `${s.recap.done}\u0000${s.recap.next}` : '')

const NOTIFY_TITLE: Record<RecapState, string> = { fini: 'a fini', question: 'a une question', attente: 'attend un résultat' }

/**
 * When a priest opens his eyes (or gets in trouble): ring the bowl, add him to the bell's list, and count
 * him in the tab title.
 *
 * A plain stop does not ring at once: it waits for his recap, where a small model says why he stopped
 * (done, a question for you, or waiting on CI…), written in the bell's list. Back to work meanwhile: it
 * was no real stop, nothing rings. No recap within RECAP_WAIT_MS: it rings anyway.
 */
export function watchPriests() {
  let previous: Record<string, SessionStatus> | null = null
  /** Stops waiting for their recap: the recap they had when they stopped, and the fallback timer. */
  const pending = new Map<string, { recap: string; timer: ReturnType<typeof setTimeout> }>()

  const announce = (s: SessionSummary, state: RecapState | undefined) => {
    const { projects, muted, notify } = useApp.getState()
    if (!muted) bowl()
    const who = agentTitle(s, projects)
    const what = s.status === 'error' ? 'est en difficulté' : NOTIFY_TITLE[state ?? 'fini']
    const body = s.recap && s.status !== 'error' ? s.recap.next : s.project ? `${s.project} · ${s.title}` : s.title
    // Every ring lands in the bell's list, so you can tell afterwards who called.
    notify({ sessionId: s.id, who, what, body })
  }

  const settle = (id: string) => {
    clearTimeout(pending.get(id)?.timer)
    pending.delete(id)
  }

  const unsubscribe = useApp.subscribe((state) => {
    const { sessions, interruptedIds, clearInterrupted } = state
    // Silenced priests (incense out) never call for you.
    const waiting = Object.values(sessions).filter((s) => ATTENTION.includes(s.status) && !s.silenced)
    document.title = waiting.length ? `(${waiting.length}) Sangha` : 'Sangha'

    const now = Object.fromEntries(Object.values(sessions).map((s) => [s.id, s.status]))
    if (previous) {
      const changed = Object.values(sessions).filter((s) => previous![s.id] && previous![s.id] !== s.status)
      // A status change right after the user's own "Interrompre" is consumed silently, not treated as a finish.
      const finished = waiting.filter((s) => previous![s.id] && !ATTENTION.includes(previous![s.id]!) && !interruptedIds.has(s.id))
      for (const s of changed) if (interruptedIds.has(s.id)) clearInterrupted(s.id)

      // Waiting stops: dropped if he went back to work (or was silenced), rung once their new recap is in.
      for (const [id, p] of pending) {
        const s = sessions[id]
        if (!s || s.status !== 'waiting' || s.silenced) settle(id)
        else if (s.recap && recapKey(s) !== p.recap) {
          settle(id)
          announce(s, s.recap.state)
        }
      }

      for (const s of finished) {
        settle(s.id)
        // An error needs no reading: it rings at once.
        if (s.status === 'error') {
          announce(s, undefined)
          continue
        }
        const timer = setTimeout(() => {
          pending.delete(s.id)
          const now = useApp.getState().sessions[s.id]
          if (now?.status === 'waiting' && !now.silenced) announce(now, undefined)
        }, RECAP_WAIT_MS)
        pending.set(s.id, { recap: recapKey(s), timer })
      }
    }
    previous = now
  })

  return () => {
    unsubscribe()
    for (const id of [...pending.keys()]) settle(id)
  }
}
