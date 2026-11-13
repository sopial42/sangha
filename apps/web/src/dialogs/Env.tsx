import { useState } from 'react'
import { envText, parseEnvText } from '@sangha/shared'
import { api } from '@/api'
import { nameOf } from '@/lib/sessions'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Modal, message } from './Modal'

/**
 * A session's own environment variables, written like a .env (paste one as is). Its process starts with
 * them: saved alone, they apply at its next start; "Save and restart" applies them now.
 */
export function EnvDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const [text, setText] = useState(() => envText(session?.env ?? {}))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null
  const { env, errors } = parseEnvText(text)
  const count = Object.keys(env).length
  const name = nameOf(session)

  const save = async (restart: boolean) => {
    if (restart && session.status === 'working' && !confirm(`${name} is working: restarting interrupts its current turn. Restart anyway?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.setEnv(id, env, restart)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Environment variables"
      description={
        <>
          For <span className="font-medium text-foreground">{name}</span> only: its process starts with them, and its commands and subagents inherit them.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="env-form" variant="outline" disabled={busy || errors.length > 0} title="They apply at its next start">
            Save
          </Button>
          <Button disabled={busy || errors.length > 0} onClick={() => void save(true)} title="Restarts it on the same conversation so they apply now">
            Save and restart
          </Button>
        </>
      }
    >
      <form
        id="env-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save(false)
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="env-text">Variables</FieldLabel>
            <Textarea
              id="env-text"
              autoFocus
              className="min-h-56 font-mono text-small"
              value={text}
              rows={10}
              spellCheck={false}
              placeholder={'OS_CLOUD=my-cloud\nKUBECONFIG=/home/me/.kube/config\n# a comment'}
              onChange={(e) => setText(e.target.value)}
            />
            <FieldDescription>
              One per line, like a <code className="font-mono">.env</code> file. {count} variable{count === 1 ? '' : 's'}, kept in Sangha's local database and carried over if the session
              starts fresh.
            </FieldDescription>
          </Field>
          {errors.map((e) => (
            <p key={e} className="text-small text-danger">
              {e}
            </p>
          ))}
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
