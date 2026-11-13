import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ApiError, api } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { Button } from '@/components/ui/button'

/** Confirm removing a project from Sangha. */
export function RemoveProject({ name, onClose }: { name: string; onClose: () => void }) {
  const project = useApp((s) => s.projects.find((p) => p.name === name))
  const sessions = useApp(useShallow((s) => Object.values(s.sessions).filter((x) => x.project === name && !x.external)))
  const [dirty, setDirty] = useState<{ title: string; files: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (force: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await api.removeProject(name, force)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDirty((err.body as { dirty: { title: string; files: number }[] }).dirty)
      else setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      size="sm"
      title={`Remove ${name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run(!!dirty)}>
            {dirty ? 'Remove anyway' : 'Remove project'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-ui text-muted-foreground">
        {sessions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p>
              {sessions.length === 1 ? 'Its session will be closed' : `Its ${sessions.length} sessions will be closed`} and the worktrees deleted
              (branches with commits are kept):
            </p>
            <ul className="flex flex-col gap-1 pl-4 text-foreground">
              {sessions.map((p) => (
                <li key={p.id} className="list-disc truncate">
                  <span className="font-medium">{p.note || p.title}</span>
                  {p.note && <span className="text-small text-muted-foreground"> ({p.title})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p>
          {project?.local ? (
            <>
              The folder <code className="font-mono text-small text-foreground">{project.path}</code> stays intact: it is only removed from Sangha.
            </>
          ) : (
            <>
              The clone <code className="font-mono text-small text-foreground">{project?.path}</code> will be <strong className="text-foreground">deleted</strong>.
            </>
          )}
        </p>
        {dirty && (
          <div className="flex flex-col gap-1 text-small text-danger" role="alert">
            <p>Uncommitted work would be lost:</p>
            <ul className="flex flex-col gap-1 pl-4">
              {dirty.map((d) => (
                <li key={d.title} className="list-disc">
                  {d.title}: {d.files} file{d.files === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
