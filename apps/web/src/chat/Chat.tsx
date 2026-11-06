import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { splitQuote, withQuote, type Quote, type QueuedMessage } from '@sangha/shared'
import { api, openSession } from '../api'
import { Md } from '../Md'
import { formatTime } from '../priests'
import { profileFor, toolIcon } from '../profiles'
import { useApp, type ChatItem } from '../store'
import { draftOf, saveDraft } from '../drafts'
import { addToStash, removeFromStash, stashOf, type StashItem } from '../stash'

const NO_QUEUED: QueuedMessage[] = []

/** Appears on a message you point at: quote it in your reply (only the part you selected, if any). */
const ReplyButton = ({ onReply }: { onReply: (msg: HTMLElement | null) => void }) => (
  <button
    type="button"
    className="msg-reply"
    // Keeps your text selection alive until the click reads it.
    onMouseDown={(e) => e.preventDefault()}
    onClick={(e) => onReply(e.currentTarget.parentElement)}
    aria-label="Répondre à ce message"
    title="Répondre (cite ce message, ou ce que tu y as sélectionné)"
  >
    ↩
  </button>
)

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
/** The message a reply quotes: who said it and the start of it; a click brings you back to it. */
function QuoteBlock({ quote, onClick, onClear }: { quote: Quote; onClick?: () => void; onClear?: () => void }) {
  const inner = (
    <>
      <span className="quote-author">{quote.author}</span>
      <span className="quote-text">{quote.text}</span>
    </>
  )
  return (
    <div className={`quote ${onClear ? 'quote-draft' : ''}`}>
      {onClick ? (
        <button type="button" className="quote-body" onClick={onClick} title="Revoir le message cité">
          {inner}
        </button>
      ) : (
        <div className="quote-body">{inner}</div>
      )}
      {onClear && (
        <button type="button" className="icon-btn quote-clear" onClick={onClear} aria-label="Ne plus citer" title="Ne plus citer (Échap)">
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * Appears on a message you point at, next to « répondre » : a quiet note for Ananda — a 👍/👎, a
 * comment, or both — about this exact message. Already commented, it stays lit so you can tell at a
 * glance which ones you've already flagged for him. The corner button only ever toggles a small form
 * that opens inline, above the message's own words (never a floating popover: the panel clips those
 * past its edge, and a short message leaves too little room beside it to anchor one safely).
 */
export function FeedbackControl({ sessionId, eventSeq, commented, onDone }: { sessionId: string; eventSeq?: number; commented: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!rating && !comment.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.sendFeedback({ sessionId, eventSeq, rating: rating ?? undefined, comment: comment.trim() || undefined })
      setOpen(false)
      setRating(null)
      setComment('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`msg-feedback${commented ? ' commented' : ''}`}
        // Keeps your text selection alive until the click reads it, same as « répondre ».
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={commented ? 'Déjà commenté pour Ananda : ajouter un mot de plus' : 'Commenter pour Ananda'}
        title={commented ? 'Déjà commenté pour Ananda' : 'Commenter ce message pour Ananda'}
      >
        💬
      </button>
      {open && (
        <form
          className="msg-feedback-form"
          aria-label="Commenter pour Ananda"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <button type="button" className={`icon-btn${rating === 'up' ? ' active-up' : ''}`} onClick={() => setRating((r) => (r === 'up' ? null : 'up'))} aria-pressed={rating === 'up'} aria-label="Pouce levé" title="👍 pour Ananda">
            👍
          </button>
          <button type="button" className={`icon-btn${rating === 'down' ? ' active-down' : ''}`} onClick={() => setRating((r) => (r === 'down' ? null : 'down'))} aria-pressed={rating === 'down'} aria-label="Pouce baissé" title="👎 pour Ananda">
            👎
          </button>
          <input autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Un mot pour Ananda…" disabled={busy} />
          <button type="submit" className="text-link" disabled={busy || (!rating && !comment.trim())}>
            Envoyer
          </button>
          <button type="button" className="text-link" onClick={() => setOpen(false)} disabled={busy}>
            Annuler
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </>
  )
}

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
          <Said text={m.text} />
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

/** Your words, with the message they reply to above them when they quote one. */
function Said({ text, onQuote }: { text: string; onQuote?: (q: Quote) => void }) {
  const { quote, body } = splitQuote(text)
  if (!quote) return <>{text}</>
  return (
    <>
      <QuoteBlock quote={quote} onClick={onQuote && (() => onQuote(quote))} />
      {body}
    </>
  )
}

/**
 * He is on it, with nothing to show yet: reading your message (the one he just got, or the next one once
 * you interrupted the first), or thinking between two steps. Three dots, like someone typing.
 */
const Typing = ({ author, reading }: { author: string; reading: boolean }) => (
  <div className="msg-typing" role="status">
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
    {author} {reading ? 'lit ton message…' : 'travaille…'}
  </div>
)

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
/** What goes with your message when « Dernière capture » is on: the image you talk about is that screenshot. */
const screenshotContext = (path: string) =>
  `\n\n[Capture d'écran jointe : l'image, la capture ou ce que « je vois » dont je parle dans ce message, c'est ma dernière capture d'écran, copiée ici : ${path}. Lis-la (outil Read) avant de répondre.]`

export function Chat({ author, external = null }: { author: string; external?: { alive: boolean } | null }) {
  const { view, selectedId: sessionId, profiles, dialog, set } = useApp()
  const queued = useApp((s) => (sessionId ? s.sessions[sessionId]?.queued : undefined)) ?? NO_QUEUED
  // Which messages already carry a word for Ananda, so their 💬 stays lit: his eventSeqs, fetched once per session.
  const [commented, setCommented] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!sessionId) return void setCommented(new Set())
    api.sessionFeedback(sessionId).then(
      (list) => setCommented(new Set(list.map((f) => f.eventSeq).filter((seq): seq is number => seq != null))),
      () => setCommented(new Set()),
    )
  }, [sessionId])
  const [text, setText] = useState(() => (sessionId ? draftOf(sessionId) : ''))
  useEffect(() => setText(sessionId ? draftOf(sessionId) : ''), [sessionId])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // « Dernière capture » switched on: your latest screenshot goes with the next message (then it switches off).
  const [withShot, setWithShot] = useState(false)
  useEffect(() => setWithShot(false), [sessionId])

  // What you set aside instead of sending right away: his own pile, popover closed until you open it.
  const [stash, setStash] = useState<StashItem[]>(() => (sessionId ? stashOf(sessionId) : []))
  useEffect(() => setStash(sessionId ? stashOf(sessionId) : []), [sessionId])
  const [stashOpen, setStashOpen] = useState(false)
  useEffect(() => setStashOpen(false), [sessionId])
  const [stashBusyId, setStashBusyId] = useState<string | null>(null)
  const [stashError, setStashError] = useState<string | null>(null)
  const stashRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stashOpen) return
    const onDown = (e: PointerEvent) => {
      if (stashRef.current && !stashRef.current.contains(e.target as Node)) setStashOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setStashOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [stashOpen])

  /** Puts the text you are writing on his pile and clears the composer. */
  const stashCurrent = () => {
    if (!sessionId || !text.trim()) return
    setStash(addToStash(sessionId, text))
    setText('')
    saveDraft(sessionId, '')
  }
  /** Brings a stashed message back into the composer (appended, if you were already writing something). */
  const resumeStashed = (item: StashItem) => {
    if (!sessionId) return
    const next = text.trim() ? `${text}\n${item.text}` : item.text
    setText(next)
    saveDraft(sessionId, next)
    setStash(removeFromStash(sessionId, item.id))
    inputRef.current?.focus()
  }
  /** Sends a stashed message straight through the same path as the composer: queued if he still works. */
  const sendStashed = async (item: StashItem) => {
    if (!sessionId) return
    setStashBusyId(item.id)
    setStashError(null)
    try {
      await api.send(sessionId, item.text)
      setStash(removeFromStash(sessionId, item.id))
    } catch (err) {
      setStashError(err instanceof Error ? err.message : String(err))
    } finally {
      setStashBusyId(null)
    }
  }
  const deleteStashed = (item: StashItem) => {
    if (!sessionId) return
    setStash(removeFromStash(sessionId, item.id))
  }

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
  }, [view.chat.length, view.draft, view.busy])
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
  const sentMessages = useMemo(() => view.chat.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user').map((i) => splitQuote(i.text).body), [view.chat])
  useEffect(() => setHistIndex(-1), [sessionId])
  // Only after we move the caret ourselves (browsing history), not on every keystroke.
  useEffect(() => {
    if (histIndex < 0) return
    const el = inputRef.current
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [histIndex])

  // Replying to a message, WhatsApp-like: it shows above the field, then leaves ahead of your words.
  const [quote, setQuote] = useState<Quote | null>(null)
  useEffect(() => setQuote(null), [sessionId])
  const replyTo = (who: string, full: string, el: HTMLElement | null) => {
    // Text selected inside that message: only that part is quoted.
    const sel = window.getSelection()
    const picked = sel && !sel.isCollapsed && el?.contains(sel.anchorNode) && el.contains(sel.focusNode) ? sel.toString().trim() : ''
    setQuote({ author: who, text: picked || splitQuote(full).body })
    inputRef.current?.focus()
  }
  const replyRef = useRef(replyTo)
  replyRef.current = replyTo

  // Back to the quoted message: loaded first if it sits among the older ones, then centered and lit up.
  const [jump, setJump] = useState<number | null>(null)
  const goToQuote = (q: Quote) => {
    const head = q.text.replace(/…$/, '').slice(0, 200)
    const chat = useApp.getState().view.chat
    let idx = -1
    for (let i = chat.length - 1; i >= 0 && idx < 0; i--) {
      const it = chat[i]!
      if ((it.kind === 'buddha' || it.kind === 'user') && splitQuote(it.text).body.includes(head)) idx = i
    }
    if (idx < 0) return
    letGo()
    setFresh(false)
    setFrom((f) => Math.min(f ?? startRef.current, Math.max(0, idx - 2)))
    setJump(idx)
  }
  const goRef = useRef(goToQuote)
  goRef.current = goToQuote

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
      let body = quote ? withQuote(quote, text) : text
      // Taken at send time: the screenshot you just made, even if you made it after switching this on.
      if (withShot) body += screenshotContext((await api.latestScreenshot()).path)
      const r = await api.send(to, body)
      saveDraft(to, '')
      setText('')
      setQuote(null)
      setWithShot(false)
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
          <div key={i} data-i={i} className="msg msg-user">
            <ReplyButton onReply={(el) => replyRef.current('toi', item.text, el)} />
            {sessionId && <FeedbackControl sessionId={sessionId} eventSeq={item.seq} commented={commented.has(item.seq)} onDone={() => setCommented((s) => new Set(s).add(item.seq))} />}
            <Time at={item.at} />
            <Said text={item.text} onQuote={(q) => goRef.current(q)} />
          </div>
        )
      case 'buddha':
        return (
          <div key={i} data-i={i} className="msg msg-buddha">
            <ReplyButton onReply={(el) => replyRef.current(author, item.text, el)} />
            {sessionId && <FeedbackControl sessionId={sessionId} eventSeq={item.seq} commented={commented.has(item.seq)} onDone={() => setCommented((s) => new Set(s).add(item.seq))} />}
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
  const startRef = useRef(start)
  startRef.current = start
  useLayoutEffect(() => {
    if (jump === null) return
    const el = logRef.current?.querySelector<HTMLElement>(`[data-i="${jump}"]`)
    setJump(null)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('msg-found')
    void el.offsetWidth // restart the glow when the same message is found twice
    el.classList.add('msg-found')
  }, [jump, start])
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
    [view.chat, start, view.monks, author, profiles, sessionId, commented],
  )
  const hiddenOlder = useMemo(() => view.chat.slice(0, start).filter(visible).length, [view.chat, start])

  const empty = view.chat.length === 0 && !view.draft
  // What he last had in front of him: your message (he is reading it) or his own work.
  const lastSaid = view.chat.findLast(visible)
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
        {view.busy && !view.draft && <Typing author={author} reading={lastSaid?.kind === 'user'} />}
        {sessionId && queued.map((m) => <Queued key={m.id} sessionId={sessionId} m={m} />)}
      </div>
      <form className="chat-input" onSubmit={submit}>
        {quote && <QuoteBlock quote={quote} onClear={() => (setQuote(null), inputRef.current?.focus())} />}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (sessionId) saveDraft(sessionId, e.target.value)
            setHistIndex(-1) // typing by hand always leaves history browsing
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && quote) {
              // Drops the quote, not the conversation.
              e.stopPropagation()
              setQuote(null)
            } else if (e.key === 'Enter' && !e.shiftKey) {
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
            } else if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
              // Mets de côté ce que j'écris, sans laisser le navigateur ouvrir sa boîte "Enregistrer".
              e.preventDefault()
              stashCurrent()
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
          <button
            type="button"
            className={`btn btn-ghost${withShot ? ' active' : ''}`}
            disabled={!sessionId || sending}
            onClick={() => setWithShot((on) => !on)}
            aria-pressed={withShot}
            title={
              withShot
                ? 'Ta dernière capture d\'écran partira avec ce message (prise au moment d\'envoyer). Clique pour annuler.'
                : 'Joindre ta dernière capture d\'écran au prochain message : il comprendra que l\'image dont tu parles, c\'est elle'
            }
          >
            {withShot ? '📷 Capture jointe ✓' : '📷 Dernière capture'}
          </button>
          <div className="stash-wrap" ref={stashRef}>
            <button
              type="button"
              className={`btn btn-ghost${stashOpen ? ' active' : ''}`}
              disabled={!sessionId}
              aria-haspopup="true"
              aria-expanded={stashOpen}
              onClick={() => setStashOpen((o) => !o)}
              title="Les messages que tu as mis de côté pour plus tard"
            >
              📥 De côté{stash.length > 0 ? ` · ${stash.length}` : ''}
            </button>
            {stashOpen && (
              <div className="stash-popover" role="menu" aria-label="Messages de côté">
                <button type="button" className="stash-current" disabled={!text.trim()} onClick={stashCurrent}>
                  Mettre de côté ce que j’écris
                </button>
                {stashError && (
                  <p className="form-error" role="alert">
                    {stashError}
                  </p>
                )}
                {stash.length === 0 ? (
                  <p className="muted small">Rien de côté pour l’instant.</p>
                ) : (
                  <ul className="stash-list">
                    {stash.map((it) => (
                      <li key={it.id} className="stash-item">
                        <time className="stash-time">{formatTime(it.at)}</time>
                        <p className="stash-preview">{it.text}</p>
                        <div className="stash-item-actions">
                          <button type="button" className="text-link" onClick={() => resumeStashed(it)}>
                            Reprendre
                          </button>
                          <button type="button" className="text-link" disabled={stashBusyId === it.id} onClick={() => void sendStashed(it)}>
                            {stashBusyId === it.id ? 'Envoi…' : 'Envoyer'}
                          </button>
                          <button type="button" className="icon-btn" aria-label="Supprimer ce message de côté" title="Supprimer" onClick={() => deleteStashed(it)}>
                            🗑
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
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
