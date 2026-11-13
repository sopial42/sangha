import { useState } from 'react'
import { ApiError, api } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { Button } from '@/components/ui/button'

/** Confirm closing a session (from the mute choice, or from its own view). */
export function Dismiss({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const working = session?.status === 'working'
  const [dirty, setDirty] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const external = session?.external

  // First without forcing: the server refuses if uncommitted work would be lost, then we ask again.
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.archive(id, dirty !== null)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDirty((err.body as { state: { dirty: number } }).state.dirty)
      else setError(message(err))
      setBusy(false)
    }
  }

  const risky = dirty !== null || (working && !external)

  return (
    <Modal
      size="sm"
      title={external ? 'Remove this session from the board?' : 'Close this session?'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant={risky ? 'destructive' : 'default'} disabled={busy} onClick={() => void run()} autoFocus>
            {dirty !== null ? 'Close anyway' : external ? 'Remove' : 'Close session'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-ui">
        {session && (
          <p className="min-w-0">
            <span className="font-medium">{session.note || session.title}</span>
            {session.note && <span className="text-small text-muted-foreground"> ({session.title})</span>}
          </p>
        )}
        <p className="text-muted-foreground">
          {external ? (
            <>It leaves the board but its terminal keeps running. It comes back if it starts working again.</>
          ) : (
            <>
              The session ends and its worktree is deleted.
              {session?.branch && (
                <>
                  {' '}
                  Its branch <code className="font-mono text-small text-foreground">{session.branch}</code> is kept if it has commits.
                </>
              )}
            </>
          )}
        </p>
        {working && !external && (
          <p className="text-small text-danger" role="alert">
            It is working right now: the current work will be interrupted.
          </p>
        )}
        {dirty !== null && (
          <p className="text-small text-danger" role="alert">
            {dirty} uncommitted file{dirty === 1 ? '' : 's'} would be lost.
          </p>
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
