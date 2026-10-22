import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { QueuedMessage } from '@sangha/shared'
import { api, openSession } from '../api'
import { Md } from '../Md'
import { formatTime } from '../priests'
import { profileFor, toolIcon } from '../profiles'
import { useApp, type ChatItem } from '../store'
import { draftOf, saveDraft } from '../drafts'

const NO_QUEUED: QueuedMessage[] = []

const Time = ({ at }: { at: number }) =>
  at ? (
    <time className="msg-time" dateTime={new Date(at).toISOString()}>
      {formatTime(at)}
    </time>
  ) : null

/**
 * A message of yours he has not read yet (he is mid-turn): dimmed, and yours to change, take back or
 * push into his current turn until it leaves on its own when the turn ends.
 */
function Queued({ sessionId, m }: { sessionId: string; m: QueuedMessage }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(m.text), [m.text])
  const run = (p: Promise<void>) => p.then(() => setError(null), (e: Error) => setError(e.message))
  return (
    <div className="msg msg-user queued">
      <span className="msg-queued-label">En attente · il le lira à la fin de son tour</span>
      {editing ? (
        <form
          className="msg-queued-edit"
          onSubmit={(e) => {
            e.preventDefault()
            void run(api.editQueued(sessionId, m.id, text)).then(() => setEditing(false))
          }}
        >
          <textarea
            value={text}
            autoFocus
            rows={Math.min(8, text.split('\n').length + 1)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                setText(m.text)
                setEditing(false)
              }
            }}
          />
          <div className="msg-queued-actions">
            <button type="submit" className="text-link" disabled={!text.trim()}>
              Enregistrer
            </button>
            <button type="button" className="text-link" onClick={() => (setText(m.text), setEditing(false))}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <>
          {m.text}
          <div className="msg-queued-actions">
            <button type="button" className="text-link" onClick={() => setEditing(true)}>
              Modifier
            </button>
            <button type="button" className="text-link" onClick={() => void run(api.sendQueuedNow(sessionId, m.id))} title="Il le lit tout de suite, au milieu de son tour">
              Envoyer maintenant
            </button>
            <button type="button" className="text-link" onClick={() => void run(api.withdrawQueued(sessionId, m.id))}>
              Retirer
            </button>
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

// Plumbing that says nothing to the user.
const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite'])
const visible = (item: ChatItem) => item.kind !== 'tool' || !HIDDEN_TOOLS.has(item.tool)

// A long session shows only its last messages, older ones loaded on demand by this many.
const PAGE = 20

/** Where to start the log so it shows `count` visible items before `end`. */
function startFor(chat: ChatItem[], end: number, count: number): number {
  let i = end
  while (i > 0 && count > 0) if (visible(chat[--i]!)) count--
  return i
}
// Buddha's own tools, in words.
const SANGHA_TOOLS: Record<string, string> = {
  list_projects: 'Consulte les projets',
  list_sessions: 'Regarde les prêtres',
  start_session: 'Lance un prêtre',
  send_to_session: 'Parle à un prêtre',
  read_session: 'Écoute un prêtre',
}

/** Conversation with one priest (or Buddha). `author` is how his words are signed. */
/**
 * Conversation with one priest (or Buddha). `external`: a session running in a terminal; replies are
 * relayed to it (alive) or resume it in Sangha (ended).
 */
export function Chat({ author, external = null }: { author: string; external?: { alive: boolean } | null }) {
  const { view, selectedId: sessionId, profiles, dialog, set } = useApp()
  const queued = useApp((s) => (sessionId ? s.sessions[sessionId]?.queued : undefined)) ?? NO_QUEUED
  const [text, setText] = useState(() => (sessionId ? draftOf(sessionId) : ''))
  useEffect(() => setText(sessionId ? draftOf(sessionId) : ''), [sessionId])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Opening him (or switching to him while the panel stays open) puts the caret straight in the
  // textarea, at the end of any restored draft — never while a dialog sits on top, and never on a
  // touch device (that would pop the virtual keyboard unasked). Waits a frame for the draft, just
  // restored above, to actually reach the textarea's value.
  useEffect(() => {
    if (!sessionId || dialog) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
    return () => cancelAnimationFrame(raf)
  }, [sessionId, dialog])

  // The log follows new words only while you are at its bottom. Reading further up, you stay where you
  // are: a blinking bell tells you new words came. Your own message always brings you down.
  // Any move up lets go at once, even a pixel: a streaming reply re-renders on every word, often before
  // the scroll event of your gesture arrives, and would otherwise pull you back down each time.
  const atBottom = useRef(true)
  const lastTop = useRef(0)
  const [fresh, setFresh] = useState(false)
  const toBottom = () => {
    const el = logRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
    }
    atBottom.current = true
    setFresh(false)
  }
  const letGo = () => {
    atBottom.current = false
  }
  // Moved up since we last looked, and not merely clamped by content that shrank under us.
  const wentUp = (el: HTMLElement) => el.scrollTop < lastTop.current - 1 && el.scrollHeight - el.scrollTop - el.clientHeight > 1
  useEffect(() => {
    atBottom.current = true
    setFresh(false)
  }, [sessionId])
  useLayoutEffect(() => {
    const el = logRef.current
    if (el && wentUp(el)) letGo()
    if (atBottom.current || view.chat.at(-1)?.kind === 'user') toBottom()
    else setFresh(true)
  }, [view.chat.length, view.draft])
  // A message you just queued brings you down too.
  const queuedBefore = useRef(queued.length)
  useLayoutEffect(() => {
    if (queued.length > queuedBefore.current) toBottom()
    queuedBefore.current = queued.length
  }, [queued.length])
  const onScroll = () => {
    const el = logRef.current
    if (!el) return
    if (wentUp(el)) letGo()
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) atBottom.current = true
    lastTop.current = el.scrollTop
    if (atBottom.current) setFresh(false)
  }
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) letGo()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) letGo()
  }

  // Recall past messages with ArrowUp/ArrowDown, like a shell history: -1 means "not browsing".
  const [histIndex, setHistIndex] = useState(-1)
  const sentMessages = useMemo(() => view.chat.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user').map((i) => i.text), [view.chat])
  useEffect(() => setHistIndex(-1), [sessionId])
  // Only after we move the caret ourselves (browsing history), not on every keystroke.
  useEffect(() => {
    if (histIndex < 0) return
    const el = inputRef.current
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [histIndex])

  const monkName = (id: string) => {
    const m = view.monks[id]
    return m ? profileFor(m.agentType, profiles).name : 'un moine'
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId || !text.trim() || sending) return
    setSending(true)
    setError(null)
    setNote(external?.alive ? 'Transmission à la session du terminal…' : null)
    const to = sessionId
    try {
      const r = await api.send(to, text)
      saveDraft(to, '')
      setText('')
      if (r?.via === 'peer') setNote(`Transmis à ${r.to} ; sa réponse apparaîtra ici.`)
      else if (r?.via === 'adopted') {
        setNote(null)
        openSession(r.id)
      } else setNote(null)
    } catch (err) {
      setNote(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const render = (item: ChatItem, i: number) => {
    switch (item.kind) {
      case 'user':
        return (
          <div key={i} className="msg msg-user">
            <Time at={item.at} />
            {item.text}
          </div>
        )
      case 'buddha':
        return (
          <div key={i} className="msg msg-buddha">
            <span className="msg-author">
              {author} <Time at={item.at} />
            </span>
            <Md text={item.text} />
          </div>
        )
      case 'tool': {
        if (HIDDEN_TOOLS.has(item.tool)) return null
        const name = item.tool.replace(/^mcp__sangha__/, '')
        return (
          <div key={i} className="chip">
            {toolIcon(item.tool)} <b>{SANGHA_TOOLS[name] ?? name}</b> {item.summary}
          </div>
        )
      }
      case 'summon':
        return (
          <button key={i} className="scroll-card" onClick={() => set({ selectedMonk: item.monkId })}>
            🔔 {author} convoque <b>{monkName(item.monkId)}</b> : {view.monks[item.monkId]?.description} <Time at={item.at} />
          </button>
        )
      case 'done': {
        const m = view.monks[item.monkId]
        return (
          <button key={i} className={`scroll-card ${m?.status === 'completed' ? 'ok' : 'ko'}`} onClick={() => set({ selectedMonk: item.monkId })}>
            {m?.status === 'completed' ? '🙏' : '🏮'} <b>{monkName(item.monkId)}</b> {m?.status === 'completed' ? 'a terminé' : `: ${m?.status}`} <Time at={item.at} />
          </button>
        )
      }
      case 'turn':
        return (
          <div key={i} className="turn-sep">
            {(item.durationMs / 1000).toFixed(1)} s · ≈ {item.costUsdEquiv.toFixed(3)} $ équivalent quota
          </div>
        )
      case 'error':
        return (
          <div key={i} className="msg msg-error" role="alert">
            {item.text}
          </div>
        )
    }
  }

  // Only the last PAGE messages at first: thousands of them in the page made every keystroke slow.
  // `from` stays null (follow the end) until you load older ones, then holds where the log starts, so
  // new words arriving do not push what you are reading out of the log.
  const [from, setFrom] = useState<number | null>(null)
  useEffect(() => setFrom(null), [sessionId])
  const start = from ?? startFor(view.chat, view.chat.length, PAGE)
  const older = useRef<number | null>(null) // scroll height before loading older messages
  const loadOlder = () => {
    older.current = logRef.current?.scrollHeight ?? null
    setFrom(startFor(view.chat, start, PAGE))
  }
  // Keep what you were reading in place once older messages appear above it.
  useLayoutEffect(() => {
    const el = logRef.current
    if (!el || older.current === null) return
    el.scrollTop += el.scrollHeight - older.current
    lastTop.current = el.scrollTop
    older.current = null
  }, [start])

  // Rendered once per change of the log, not on every keystroke in the textarea: a long session's
  // markdown would otherwise be parsed again for each letter typed.
  const log = useMemo(
    () => view.chat.slice(start).map((item, i) => render(item, start + i)),
    [view.chat, start, view.monks, author, profiles],
  )
  const hiddenOlder = useMemo(() => view.chat.slice(0, start).filter(visible).length, [view.chat, start])

  const empty = view.chat.length === 0 && !view.draft
  return (
    <section className="chat" aria-label={`Conversation avec ${author}`}>
      {fresh && (
        <button type="button" className="chat-fresh" onClick={toBottom} aria-label="Nouveaux messages : descendre">
          🔔 Nouveaux messages
        </button>
      )}
      <div className="chat-log" aria-live="polite" ref={logRef} onScroll={onScroll} onWheel={onWheel} onKeyDown={onKeyDown}>
        {empty && (
          <div className="chat-empty">
            <p className="chat-empty-title">Silence.</p>
            <p>{`Écris à ${author}.`}</p>
          </div>
        )}
        {hiddenOlder > 0 && (
          <button type="button" className="chat-older" onClick={loadOlder}>
            {Math.min(PAGE, hiddenOlder)} messages plus anciens · {hiddenOlder} masqués
          </button>
        )}
        {log}
        {view.draft && (
          <div className="msg msg-buddha streaming">
            <span className="msg-author">{author}</span>
            {view.draft}
          </div>
        )}
        {sessionId && queued.map((m) => <Queued key={m.id} sessionId={sessionId} m={m} />)}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (sessionId) saveDraft(sessionId, e.target.value)
            setHistIndex(-1) // typing by hand always leaves history browsing
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit(e)
            } else if (e.key === 'ArrowUp') {
              // Only recall history from an empty field, or while already browsing it.
              if ((histIndex >= 0 || text === '') && sentMessages.length > 0) {
                e.preventDefault()
                const next = Math.min(histIndex + 1, sentMessages.length - 1)
                setHistIndex(next)
                setText(sentMessages[sentMessages.length - 1 - next] ?? '')
              }
            } else if (e.key === 'ArrowDown' && histIndex >= 0) {
              e.preventDefault()
              const next = histIndex - 1
              setHistIndex(next)
              setText(next === -1 ? '' : (sentMessages[sentMessages.length - 1 - next] ?? ''))
            }
          }}
          placeholder={
            external
              ? external.alive
                ? `Réponds à ${author} (transmis à sa session du terminal)…`
                : `Réponds à ${author} (son terminal est fermé : Sangha reprend la session)…`
              : `Parle à ${author}…`
          }
          disabled={!sessionId}
          readOnly={sending}
          rows={2}
          aria-label={`Message à ${author}`}
        />
        <div className="chat-actions">
          {view.busy && sessionId && !external && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                // Mark before calling: the bell must not ring when the priest stops because we asked him to.
                useApp.getState().markInterrupted(sessionId)
                void api.interrupt(sessionId)
              }}
            >
              Interrompre
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!sessionId || sending || !text.trim()}>
            Envoyer
          </button>
        </div>
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
