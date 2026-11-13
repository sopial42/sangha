import { useState } from 'react'
import { api, setAsideFailure } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'

/**
 * A session's name, your own word for it. `setAside`: opened when setting aside a session that has no
 * name yet. Once set aside, hovering it is all you see of it, so a name now says where it stands; it is
 * set aside once saved (or without one).
 */
export function NoteEditor({ id, setAside, onClose }: { id: string; setAside?: boolean; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [note, setNote] = useState(session?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const save = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      if (value !== (session.note ?? null)) await api.note(id, value)
    } catch (err) {
      setError(message(err))
      setBusy(false)
      return
    }
    if (setAside) {
      try {
        await api.setAside(id, true)
      } catch (err) {
        setError(setAsideFailure(err))
        setBusy(false)
        return
      }
    }
    onClose()
  }

  return (
    <Modal
      title={setAside ? 'Name it before setting it aside?' : session.note ? 'Rename session' : 'Name this session'}
      description={session.title}
      onClose={onClose}
      footer={
        <>
          {setAside ? (
            <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy} className="sm:mr-auto">
              Set aside without a name
            </Button>
          ) : (
            session.note != null && (
              <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy} className="text-danger sm:mr-auto">
                Clear name
              </Button>
            )
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save(note.trim() || null)} disabled={busy}>
            {setAside ? 'Set aside' : 'Save'}
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="note-name">Name</FieldLabel>
          <Textarea
            id="note-name"
            autoFocus
            value={note}
            maxLength={500}
            rows={3}
            placeholder="A reminder for you, shown under the session on the board"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void save(note.trim() || null)
              }
            }}
          />
          {setAside && <FieldDescription>Once set aside, its name is what you see when you hover it: a word to remind you where it stands.</FieldDescription>}
        </Field>
        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
      </FieldGroup>
    </Modal>
  )
}
