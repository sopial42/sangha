import { useState } from 'react'
import { api } from '@/api'
import { nameOf } from '@/lib/sessions'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Modal, message } from './Modal'

/**
 * Hands a session to the Orchestrator, who moves it to a fresh session at the right moment. What you
 * write here (as long as needed) goes to a file under /tmp that the fresh session reads first, like a skill.
 */
export function HandoffDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const handOff = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.handoff(id, true, context.trim() || undefined)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Hand off to a fresh session"
      description={
        <>
          The Orchestrator moves <span className="font-medium text-foreground">{nameOf(session)}</span> to a fresh session when the moment is right, with a handoff it writes itself.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="handoff-form" disabled={busy}>
            Hand off
          </Button>
        </>
      }
    >
      <form id="handoff-form" onSubmit={handOff}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="handoff-context">
              Context for the fresh session <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id="handoff-context"
              autoFocus
              className="min-h-72 text-small"
              value={context}
              rows={14}
              placeholder="Goal, decisions, constraints, links, log excerpts"
              onChange={(e) => setContext(e.target.value)}
            />
            <FieldDescription>
              Add everything the new session should know, however long. It goes into a temporary file (under <code className="font-mono">/tmp</code>) the session reads first, like a skill.
              {context.length > 0 && ` ${context.length.toLocaleString('en-US')} characters.`}
            </FieldDescription>
          </Field>
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
        </FieldGroup>
      </form>
    </Modal>
  )
}
