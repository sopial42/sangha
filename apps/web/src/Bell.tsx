import { useEffect, useRef, useState } from 'react'
import { openSession } from './api'
import { formatTime } from './priests'
import { useApp } from './store'

/**
 * Top right bell: who rang lately, newest first, each opening his session; the unread count on it. The
 * sound switch lives here too, so one bell says both what rang and whether it rings.
 */
export function Bell() {
  const notifications = useApp((s) => s.notifications)
  const sessions = useApp((s) => s.sessions)
  const muted = useApp((s) => s.muted)
  const toggleMuted = useApp((s) => s.toggleMuted)
  const readNotifications = useApp((s) => s.readNotifications)
  const clearNotifications = useApp((s) => s.clearNotifications)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Opening the list is reading it.
  useEffect(() => {
    if (open) readNotifications()
  }, [open, notifications.length, readNotifications])

  return (
    <div className="bell" ref={wrapRef}>
      <button
        className={`btn btn-ghost bell-btn ${open ? 'active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} non lues` : 'Notifications'}
        title="Qui a sonné"
        onClick={() => setOpen((o) => !o)}
      >
        {muted ? '🔕' : '🔔'}
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-popover" role="menu" aria-label="Notifications">
          <header className="bell-head">
            <h4>Notifications</h4>
            <button type="button" className="text-link" onClick={toggleMuted}>
              {muted ? 'Rallumer le son' : 'Couper le son'}
            </button>
          </header>
          {notifications.length === 0 ? (
            <p className="muted small">Personne n’a sonné.</p>
          ) : (
            <ul className="bell-list">
              {notifications.map((n) => {
                const gone = !sessions[n.sessionId]
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`bell-item ${n.read ? '' : 'unread'}`}
                      disabled={gone}
                      title={gone ? 'Cette session n’est plus dans la cour' : 'Ouvrir sa session'}
                      onClick={() => {
                        setOpen(false)
                        openSession(n.sessionId)
                      }}
                    >
                      <span className="bell-item-head">
                        <b>{n.who}</b> {n.what}
                        <time className="bell-time">{formatTime(n.at)}</time>
                      </span>
                      <span className="bell-item-body">{n.body}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {notifications.length > 0 && (
            <button type="button" className="text-link bell-clear" onClick={clearNotifications}>
              Vider la liste
            </button>
          )}
        </div>
      )}
    </div>
  )
}
