import { useEffect, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

/**
 * Your standing instruction for the session ("be concise"…), sent along with each of your messages. Saved when
 * you leave the field, press Enter or click Save; Escape puts back what was saved.
 */
export function ReminderBox({ id, saved }: { id: string; saved: string | null }) {
  const [text, setText] = useState(saved ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => setText(saved ?? ''), [saved])
  const dirty = text.trim() !== (saved ?? '')
  const save = () => {
    if (dirty) api.reminder(id, text.trim() || null).then(() => setFailed(false), () => setFailed(true))
  }
  return (
    <Field className="gap-2">
      <Textarea
        value={text}
        maxLength={500}
        rows={2}
        aria-label="Standing instruction"
        aria-invalid={failed || undefined}
        placeholder="For example: be concise"
        className="min-h-14 text-small"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setText(saved ?? '')
          }
        }}
      />
      {failed ? (
        <p role="alert" className="text-small text-danger">
          Not saved: the server refused it (restarted since?).
        </p>
      ) : (
        <FieldDescription className="text-meta">Sent to the session with each of your messages.</FieldDescription>
      )}
      {dirty && (
        <Button variant="outline" size="sm" className="self-end" onMouseDown={(e) => e.preventDefault()} onClick={save}>
          Save
        </Button>
      )}
    </Field>
  )
}
