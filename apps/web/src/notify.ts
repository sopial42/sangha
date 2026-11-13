import { BUDDHA_SESSION_ID, type SessionStatus, type SessionSummary } from '@sangha/shared'
import { nameOf } from './lib/sessions'
import { useApp } from './store'

const ATTENTION: SessionStatus[] = ['waiting', 'error']
/** How long a stop waits for its recap (which says why it stopped) before chiming anyway. */
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
 * A soft chime, synthesized (no audio file): a low fundamental with a bowl's inharmonic partials,
 * each doubled slightly off-pitch so they beat, a soft strike and a long fade.
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

/**
 * When a session stops (or hits an error): chime, and count it in the tab title.
 *
 * A plain stop does not ring at once: it waits for its recap, where a small model says why it stopped
 * (done, a question for you, or waiting on CI). Back to work meanwhile: it
 * was no real stop, nothing rings. No recap within RECAP_WAIT_MS: it rings anyway.
 */
export function watchSessions() {
  let previous: Record<string, SessionStatus> | null = null
  /** Stops waiting for their recap: the recap they had when they stopped, and the fallback timer. */
  const pending = new Map<string, { recap: string; timer: ReturnType<typeof setTimeout> }>()

  const announce = () => {
    if (!useApp.getState().muted) bowl()
  }

  const settle = (id: string) => {
    clearTimeout(pending.get(id)?.timer)
    pending.delete(id)
  }

  const unsubscribe = useApp.subscribe((state) => {
    const { sessions, selectedId, interruptedIds, clearInterrupted } = state
    // Muted sessions never call for you; neither do headless children (`parent` set): their parent
    // answers to you, even once their own `claude -p` exits.
    const waiting = Object.values(sessions).filter((s) => ATTENTION.includes(s.status) && !s.silenced && !s.parent)
    // The tab says which session you're looking at, so a pile of tabs still reads apart.
    const openLabel = selectedId === BUDDHA_SESSION_ID ? 'Orchestrator' : selectedId && sessions[selectedId] ? nameOf(sessions[selectedId]!) : null
    const base = openLabel ? `${openLabel} · Sangha` : 'Sangha'
    document.title = waiting.length ? `(${waiting.length}) ${base}` : base

    const now = Object.fromEntries(Object.values(sessions).map((s) => [s.id, s.status]))
    if (previous) {
      const changed = Object.values(sessions).filter((s) => previous![s.id] && previous![s.id] !== s.status)
      // A status change right after the user's own "Interrompre" is consumed silently, not treated as a finish.
      const finished = waiting.filter((s) => previous![s.id] && !ATTENTION.includes(previous![s.id]!) && !interruptedIds.has(s.id))
      for (const s of changed) if (interruptedIds.has(s.id)) clearInterrupted(s.id)

      // Waiting stops: dropped if it went back to work (or was muted), rung once the new recap is in.
      for (const [id, p] of pending) {
        const s = sessions[id]
        if (!s || s.status !== 'waiting' || s.silenced) settle(id)
        else if (s.recap && recapKey(s) !== p.recap) {
          settle(id)
          announce()
        }
      }

      for (const s of finished) {
        settle(s.id)
        // An error needs no reading: it rings at once.
        if (s.status === 'error') {
          announce()
          continue
        }
        const timer = setTimeout(() => {
          pending.delete(s.id)
          const now = useApp.getState().sessions[s.id]
          if (now?.status === 'waiting' && !now.silenced) announce()
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

/** At most one host strike in this long: a strained machine stays strained for a while. */
const HOST_RING_GAP_MS = 15 * 60_000

/**
 * The machine just became strained (from no suggestion to some): one soft strike of the bowl. Not on
 * every new suggestion id: ids name the top process (`cpu:process:claude`…), which flips each time a
 * session starts answering, and rang with nearly every reply. The machine chip in the top bar says what it's about.
 */
export function watchHostSuggestions() {
  let strained: boolean | null = null
  let rangAt = 0
  return useApp.subscribe((state) => {
    const now = (state.host?.suggestions.length ?? 0) > 0
    if (strained === false && now && !state.muted && Date.now() - rangAt > HOST_RING_GAP_MS) {
      rangAt = Date.now()
      bowl()
    }
    strained = now
  })
}
