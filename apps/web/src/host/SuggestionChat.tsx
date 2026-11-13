import { useState, type FormEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon } from '@hugeicons/core-free-icons'
import type { HostChatTurn, HostSuggestion } from '@sangha/shared'
import { api } from '@/api'
import { Md } from '@/Md'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

/** Each suggestion's exchange, kept while the page lives (closing the report does not lose it). */
const chats = new Map<string, HostChatTurn[]>()

/** A small chat under a suggestion: ask why, what it would lose, how to check first. A model answers, seeing the machine. */
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
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Ask a question
      </Button>
    )

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {(turns.length > 0 || busy) && (
        <BubbleGroup>
          {turns.map((t, i) => (
            <Bubble key={i} align={t.role === 'user' ? 'end' : 'start'} variant={t.role === 'user' ? 'secondary' : 'ghost'}>
              <BubbleContent className="text-small">{t.role === 'assistant' ? <Md text={t.text} /> : t.text}</BubbleContent>
            </Bubble>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-small text-muted-foreground">
              <Spinner /> Thinking
            </div>
          )}
        </BubbleGroup>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <form className="flex gap-2" onSubmit={send}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={turns.length ? 'Another question' : 'e.g. what do I lose if I do this?'}
          aria-label="Question about this suggestion"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          <HugeiconsIcon icon={SentIcon} data-icon="inline-start" />
          Ask
        </Button>
      </form>
    </div>
  )
}
