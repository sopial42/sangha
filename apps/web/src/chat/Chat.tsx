import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, openSession } from '../api'
import { Md } from '../Md'
import { formatTime } from '../priests'
import { profileFor, toolIcon } from '../profiles'
import { useApp, type ChatItem } from '../store'

const Time = ({ at }: { at: number }) =>
  at ? (
    <time className="msg-time" dateTime={new Date(at).toISOString()}>
      {formatTime(at)}
    </time>
  ) : null

// Plumbing that says nothing to the user.
const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite'])
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
  const { view, selectedId: sessionId, profiles, set } = useApp()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The log follows new words only while you are at its bottom. Reading further up, you stay where you
  // are: a blinking bell tells you new words came. Your own message always brings you down.
  const atBottom = useRef(true)
  const [fresh, setFresh] = useState(false)
  const toBottom = () => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setFresh(false)
  }
  useEffect(() => {
    atBottom.current = true
    setFresh(false)
  }, [sessionId])
  useLayoutEffect(() => {
    if (atBottom.current || view.chat.at(-1)?.kind === 'user') toBottom()
    else setFresh(true)
  }, [view.chat.length, view.draft])
  const onScroll = () => {
    const el = logRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom.current) setFresh(false)
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
    if (!sessionId || !text.trim()) return
    setSending(true)
    setError(null)
    setNote(external?.alive ? 'Transmission à la session du terminal…' : null)
    try {
      const r = await api.send(sessionId, text)
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

  const empty = view.chat.length === 0 && !view.draft
  return (
    <section className="chat" aria-label={`Conversation avec ${author}`}>
      {fresh && (
        <button type="button" className="chat-fresh" onClick={toBottom} aria-label="Nouveaux messages : descendre">
          🔔 Nouveaux messages
        </button>
      )}
      <div className="chat-log" aria-live="polite" ref={logRef} onScroll={onScroll}>
        {empty && (
          <div className="chat-empty">
            <p className="chat-empty-title">Silence.</p>
            <p>{`Écris à ${author}.`}</p>
          </div>
        )}
        {view.chat.map(render)}
        {view.draft && (
          <div className="msg msg-buddha streaming">
            <span className="msg-author">{author}</span>
            {view.draft}
          </div>
        )}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
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
          disabled={!sessionId || sending}
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
