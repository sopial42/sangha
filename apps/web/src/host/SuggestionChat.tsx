import { useState, type FormEvent } from 'react'
import type { HostChatTurn, HostSuggestion } from '@sangha/shared'
import { api } from '../api'
import { Md } from '../Md'

/** Each suggestion's exchange, kept while the page lives (closing the report does not lose it). */
const chats = new Map<string, HostChatTurn[]>()

/** A little chat under a suggestion: ask why, what it would lose, how to check first… A model answers, seeing the machine. */
export function SuggestionChat({ suggestion }: { suggestion: HostSuggestion }) {
  const [turns, setTurns] = useState<HostChatTurn[]>(() => chats.get(suggestion.id) ?? [])
  const [open, setOpen] = useState(turns.length > 0)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (next: HostChatTurn[]) => {
    chats.set(suggestion.id, next)
    setTurns(next)
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    const asked = [...turns, { role: 'user' as const, text }]
    update(asked)
    setDraft('')
    setBusy(true)
    setError(null)
    try {
      const { answer } = await api.askHost(suggestion, asked)
      update([...asked, { role: 'assistant', text: answer }])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button type="button" className="btn btn-ghost host-chat-open" onClick={() => setOpen(true)}>
        Poser une question
      </button>
    )

  return (
    <div className="host-chat">
      {turns.map((t, i) => (
        <div key={i} className={`host-chat-turn host-chat-${t.role}`}>
          {t.role === 'assistant' ? <Md text={t.text} /> : t.text}
        </div>
      ))}
      {busy && <div className="host-chat-turn host-chat-assistant muted">…</div>}
      {error && <p className="host-chat-error">{error}</p>}
      <form className="host-chat-form" onSubmit={send}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={turns.length ? 'Une autre question…' : 'Ex. : je perds quoi si je le fais ?'}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          Demander
        </button>
      </form>
    </div>
  )
}
