import { useState } from 'react'
import { api } from '@/api'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal, message } from './Modal'

/** Who every session commits as. Required: until it is set, Sangha refuses them git. */
export function GitIdentityDialog({ onClose }: { onClose: () => void }) {
  const gitIdentity = useApp((s) => s.gitIdentity)
  const set = useApp((s) => s.set)
  const [name, setName] = useState(gitIdentity?.name ?? '')
  const [email, setEmail] = useState(gitIdentity?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      set({ gitIdentity: await api.saveGitIdentity({ name: name.trim(), email: email.trim() }) })
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Git identity"
      description="Every session commits with this name and email, in every project. Until both are set, sessions can't use git."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="git-identity-form" disabled={busy || !name.trim() || !email.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="git-identity-form" onSubmit={save}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="git-name">Name</FieldLabel>
            <Input id="git-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" autoComplete="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="git-email">Email</FieldLabel>
            <Input id="git-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="first.last@example.com" autoComplete="email" />
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
