import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ThumbsDownIcon, ThumbsUpIcon } from '@hugeicons/core-free-icons'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Your word on this whole conversation, for the Advisor: a thumb lands the instant you click it (the Advisor
 * only reads feedback later, in bulk, so nothing happens right away), a comment is one click further and optional.
 * Unlike a message's own feedback button (which opens a small form first), a thumb here is never a maybe: click
 * it and it is sent.
 */
export function ConversationFeedback({ sessionId }: { sessionId: string }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [sent, setSent] = useState(false)
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vote = async (r: 'up' | 'down') => {
    setBusy(true)
    setError(null)
    try {
      await api.sendFeedback({ sessionId, rating: r })
      setRating(r)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sendComment = async () => {
    if (!comment.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.sendFeedback({ sessionId, comment: comment.trim(), rating: rating ?? undefined })
      setComment('')
      setOpen(false)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Your feedback on this conversation, for the Advisor">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-meta text-muted-foreground">How did this conversation go?</span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => void vote('up')}
          aria-pressed={rating === 'up'}
          aria-label="Thumbs up for this conversation"
          title="Thumbs up, for the Advisor"
          className={cn('text-muted-foreground', rating === 'up' && 'bg-muted text-foreground')}
        >
          <HugeiconsIcon icon={ThumbsUpIcon} strokeWidth={1.8} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => void vote('down')}
          aria-pressed={rating === 'down'}
          aria-label="Thumbs down for this conversation"
          title="Thumbs down, for the Advisor"
          className={cn('text-muted-foreground', rating === 'down' && 'bg-muted text-foreground')}
        >
          <HugeiconsIcon icon={ThumbsDownIcon} strokeWidth={1.8} />
        </Button>
        {!open && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
            Comment
          </Button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void sendComment()
          }}
        >
          <Input autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="A word for the Advisor…" aria-label="Comment for the Advisor" disabled={busy} className="text-small" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !comment.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
      {sent && !open && (
        <p className="text-meta text-muted-foreground" role="status">
          Thanks, the Advisor will read it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
