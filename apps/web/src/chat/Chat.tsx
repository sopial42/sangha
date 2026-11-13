import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Archive02Icon,
  ArrowDown02Icon,
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  Camera01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Comment01Icon,
  Delete02Icon,
  StopIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { splitQuote, withQuote, type Quote, type QueuedMessage } from '@sangha/shared'
import { api, openSession } from '@/api'
import { Md } from '@/Md'
import { CopyButton } from '@/CopyButton'
import { profileFor, toolIconOf } from '@/profiles'
import { useApp, type ChatItem } from '@/store'
import { draftOf, saveDraft } from '@/drafts'
import { addToStash, removeFromStash, stashOf, type StashItem } from '@/stash'
import { formatCost } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { PebbleIcon } from '@/components/pebble/Pebble'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace'
import { clock } from '@/lib/time'

const NO_QUEUED: QueuedMessage[] = []

/** Hidden until you point at the message (always shown on touch screens, where nothing hovers). */
const ON_HOVER = 'opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'

const Time = ({ at }: { at: number }) =>
  at ? (
    <time className="text-meta font-normal text-muted-foreground tabular-nums" dateTime={new Date(at).toISOString()}>
      {clock(at)}
    </time>
  ) : null

/** An icon button with a tooltip. */
function Tip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Appears on a message you point at: quote it in your reply (only the part you selected, if any). */
const ReplyButton = ({ onReply }: { onReply: (msg: HTMLElement | null) => void }) => (
  <Tip label="Reply (quotes this message, or the part you selected)">
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn('text-muted-foreground', ON_HOVER)}
      // Keeps your text selection alive until the click reads it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onReply(e.currentTarget.closest<HTMLElement>('[data-slot=message]'))}
      aria-label="Reply to this message"
    >
      <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={1.8} />
    </Button>
  </Tip>
)

/** The message a reply quotes: who said it and the start of it; a click brings you back to it. */
function QuoteBlock({ quote, onClick, onClear }: { quote: Quote; onClick?: () => void; onClear?: () => void }) {
  const inner = (
    <>
      <span className="text-meta font-medium text-foreground">{quote.author}</span>
      <span className="line-clamp-2 text-small text-muted-foreground">{quote.text}</span>
    </>
  )
  return (
    <div className="flex min-w-0 items-start gap-2 border-l-2 border-muted-foreground/40 pl-2">
      {onClick ? (
        <button type="button" className="flex min-w-0 flex-1 flex-col text-left outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50" onClick={onClick} title="Show the quoted message">
          {inner}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">{inner}</div>
      )}
      {onClear && (
        <Tip label="Stop quoting (Esc)">
          <Button type="button" variant="ghost" size="icon-xs" onClick={onClear} aria-label="Stop quoting">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} />
          </Button>
        </Tip>
      )}
    </div>
  )
}

/**
 * Appears on a message you point at, next to "reply": a quiet note for the Advisor (a thumbs up or
 * down, a comment, or both) about this exact message. Once commented, the button stays lit so you can
 * tell at a glance which messages you already flagged. It only toggles a small form that opens inline,
 * in the flow of the message (never a floating popover: the panel would clip it at its edge).
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
      <Tip label={commented ? 'Already noted for the Advisor: add another note' : 'Leave a note on this message for the Advisor'}>
        <Button
          type="button"
          variant={open ? 'secondary' : 'ghost'}
          size="icon-xs"
          className={cn(commented ? 'text-foreground' : 'text-muted-foreground', !commented && !open && ON_HOVER)}
          // Keeps your text selection alive until the click reads it, same as "reply".
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={commented ? 'Already noted for the Advisor: add another note' : 'Note for the Advisor'}
        >
          <HugeiconsIcon icon={Comment01Icon} strokeWidth={1.8} />
        </Button>
      </Tip>
      {open && (
        <form
          className="flex basis-full flex-wrap items-center gap-1 pt-1"
          aria-label="Note for the Advisor"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Button
            type="button"
            variant={rating === 'up' ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setRating((r) => (r === 'up' ? null : 'up'))}
            aria-pressed={rating === 'up'}
            aria-label="Thumbs up"
            title="Thumbs up for the Advisor"
          >
            <HugeiconsIcon icon={ThumbsUpIcon} strokeWidth={1.8} />
          </Button>
          <Button
            type="button"
            variant={rating === 'down' ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setRating((r) => (r === 'down' ? null : 'down'))}
            aria-pressed={rating === 'down'}
            aria-label="Thumbs down"
            title="Thumbs down for the Advisor"
          >
            <HugeiconsIcon icon={ThumbsDownIcon} strokeWidth={1.8} />
          </Button>
          <Input
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="A note for the Advisor…"
            aria-label="Note for the Advisor"
            disabled={busy}
            className="h-7 min-w-40 flex-1"
          />
          <Button type="submit" size="sm" disabled={busy || (!rating && !comment.trim())}>
            Send
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          {error && (
            <p role="alert" className="basis-full text-small text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  )
}

/**
 * A message of yours Claude has not read yet (mid-turn): shown above the composer, and yours to change,
 * take back or push into the current turn until it goes out on its own when the turn ends.
 */
function Queued({ sessionId, author, m }: { sessionId: string; author: string; m: QueuedMessage }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(m.text), [m.text])
  const run = (p: Promise<void>) => p.then(() => setError(null), (e: Error) => setError(e.message))
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-card px-3 py-2">
      <span className="flex items-center gap-1 text-meta text-muted-foreground">
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.8} className="size-3.5" aria-hidden />
        Queued: {author} reads it when this turn ends
      </span>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(api.editQueued(sessionId, m.id, text)).then(() => setEditing(false))
          }}
        >
          <Textarea
            value={text}
            autoFocus
            aria-label="Edit queued message"
            className="max-h-48 min-h-0 text-small md:text-small"
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
          <div className="flex items-center gap-1">
            <Button type="submit" size="xs" disabled={!text.trim()}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => (setText(m.text), setEditing(false))}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="line-clamp-4 flex flex-col gap-1 text-small whitespace-pre-wrap">
            <Said text={m.text} />
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => void run(api.sendQueuedNow(sessionId, m.id))} title={`${author} reads it right away, in the middle of the turn`}>
              Send now
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => void run(api.withdrawQueued(sessionId, m.id))}>
              Withdraw
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
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
      <span>{body}</span>
    </>
  )
}

/** The agent's side of a row: its pebble, its name and the time, then whatever it said or did. */
function AgentMessage({ author, at, children, actions }: { author: string; at?: number; children: ReactNode; actions?: ReactNode }) {
  return (
    <Message>
      <MessageAvatar className="mt-0.5 size-7 min-w-7 self-start bg-transparent">
        <PebbleIcon sprite="icon-stone-open" size={24} />
      </MessageAvatar>
      <MessageContent className="gap-1">
        <MessageHeader className="h-7 gap-2 px-0 text-meta font-medium text-muted-foreground">
          <span>{author}</span>
          {at ? <Time at={at} /> : null}
        </MessageHeader>
        {children}
        {actions && <div className="-ml-1 flex flex-wrap items-center gap-1">{actions}</div>}
      </MessageContent>
    </Message>
  )
}

/**
 * Claude is on it, with nothing to show yet: reading your message (the one it just got, or the next one
 * once you interrupted the first), or thinking between two steps.
 */
const Typing = ({ author, reading }: { author: string; reading: boolean }) => (
  <AgentMessage author={author}>
    <div role="status">
      <TraceLine status="running" className="text-small">
        <TraceTitle>{reading ? 'Reading your message' : 'Working'}</TraceTitle>
      </TraceLine>
    </div>
  </AgentMessage>
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

// The Orchestrator's own tools, in words.
const SANGHA_TOOLS: Record<string, string> = {
  list_projects: 'Looks at the projects',
  list_sessions: 'Looks at the sessions',
  start_session: 'Starts a session',
  send_to_session: 'Messages a session',
  read_session: 'Reads a session',
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** One tool call: its name and what it worked on, unfolding to the full detail when it does not fit. */
function ToolLine({ item }: { item: ToolItem }) {
  const name = item.tool.replace(/^mcp__sangha__/, '')
  const label = SANGHA_TOOLS[name] ?? name
  const icon = (
    <TraceIcon>
      <HugeiconsIcon icon={toolIconOf(item.tool)} strokeWidth={1.8} />
    </TraceIcon>
  )
  if (!item.summary)
    return (
      <TraceLine className="text-small">
        {icon}
        <TraceTitle className="font-medium">{label}</TraceTitle>
      </TraceLine>
    )
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger className="text-small">
        <TraceLine className="text-small">
          {icon}
          <TraceTitle className="shrink-0 font-medium">{label}</TraceTitle>
          <span className="min-w-0 truncate font-mono text-meta">{item.summary}</span>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <pre className="font-mono text-meta whitespace-pre-wrap [overflow-wrap:anywhere]">{item.summary}</pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** What goes with your message when "Screenshot" is on: the image you talk about is that screenshot. */
const screenshotContext = (path: string) =>
  `\n\n[Screenshot attached: the image, screenshot or "what I see" that I mention in this message is my latest screenshot, copied here: ${path}. Read it (Read tool) before replying.]`

type ChatProps = { author: string; external?: { alive: boolean } | null }

/**
 * Conversation with one session (or the Orchestrator). `author` is how its words are signed.
 * `external`: a session started in a terminal; replies are relayed to it (alive) or resume it here (ended).
 * Everything is keyed to the session, so switching sessions starts from a clean slate scrolled to the end.
 */
export function Chat(props: ChatProps) {
  const sessionId = useApp((s) => s.selectedId)
  return (
    <MessageScrollerProvider key={sessionId ?? ''} autoScroll>
      <Conversation {...props} />
    </MessageScrollerProvider>
  )
}

function Conversation({ author, external = null }: ChatProps) {
  const view = useApp((s) => s.view)
  const sessionId = useApp((s) => s.selectedId)
  const profiles = useApp((s) => s.profiles)
  const dialog = useApp((s) => s.dialog)
  const set = useApp((s) => s.set)
  const queued = useApp((s) => (sessionId ? s.sessions[sessionId]?.queued : undefined)) ?? NO_QUEUED
  const scroller = useMessageScroller()
  // The history arrives in bulk with its own (older) timestamps: only what happens after opening settles in.
  const openedAt = useRef(Date.now()).current
  const live = (at: number) => at > openedAt && 'motion-enter'
  // Which messages already carry a note for the Advisor, so their button stays lit: event seqs, fetched once per session.
  const [commented, setCommented] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!sessionId) return
    api.sessionFeedback(sessionId).then(
      (list) => setCommented(new Set(list.map((f) => f.eventSeq).filter((seq): seq is number => seq != null))),
      () => setCommented(new Set()),
    )
  }, [sessionId])
  const [text, setText] = useState(() => (sessionId ? draftOf(sessionId) : ''))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Screenshot" switched on: your latest screenshot goes with the next message (then it switches off).
  const [withShot, setWithShot] = useState(false)

  // What you set aside instead of sending right away: one pile per session, in a popover.
  const [stash, setStash] = useState<StashItem[]>(() => (sessionId ? stashOf(sessionId) : []))
  const [stashOpen, setStashOpen] = useState(false)
  const [stashBusyId, setStashBusyId] = useState<string | null>(null)
  const [stashError, setStashError] = useState<string | null>(null)

  /** Puts the text you are writing on the pile and clears the composer. */
  const stashCurrent = () => {
    if (!sessionId || !text.trim()) return
    setStash(addToStash(sessionId, text))
    setText('')
    saveDraft(sessionId, '')
  }
  /** Brings a set-aside message back into the composer (appended, if you were already writing something). */
  const resumeStashed = (item: StashItem) => {
    if (!sessionId) return
    const next = text.trim() ? `${text}\n${item.text}` : item.text
    setText(next)
    saveDraft(sessionId, next)
    setStash(removeFromStash(sessionId, item.id))
    setStashOpen(false)
    inputRef.current?.focus()
  }
  /** Sends a set-aside message through the same path as the composer: queued if Claude still works. */
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

  // Opening a session (or switching to it while the panel stays open) puts the caret straight in the
  // textarea, at the end of any restored draft. Never while a dialog sits on top, and never on a touch
  // device (that would pop the virtual keyboard unasked). Waits a frame for the draft to reach the textarea.
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

  // The scroller follows new words while you are at the bottom and lets go as soon as you scroll up.
  // Your own message always brings you down.
  const lastKind = view.chat.at(-1)?.kind
  useLayoutEffect(() => {
    if (lastKind === 'user') scroller.scrollToEnd()
  }, [view.chat.length, lastKind, scroller])

  // Recall past messages with ArrowUp/ArrowDown, like a shell history: -1 means "not browsing".
  const [histIndex, setHistIndex] = useState(-1)
  const sentMessages = useMemo(() => view.chat.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user').map((i) => splitQuote(i.text).body), [view.chat])
  // Only after we move the caret ourselves (browsing history), not on every keystroke.
  useEffect(() => {
    if (histIndex < 0) return
    const el = inputRef.current
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [histIndex])

  // Replying to a message: it shows above the field, then goes out ahead of your words.
  const [quote, setQuote] = useState<Quote | null>(null)
  const replyTo = (who: string, full: string, el: HTMLElement | null) => {
    // Text selected inside that message: only that part is quoted.
    const sel = window.getSelection()
    const picked = sel && !sel.isCollapsed && el?.contains(sel.anchorNode) && el.contains(sel.focusNode) ? sel.toString().trim() : ''
    setQuote({ author: who, text: picked || splitQuote(full).body })
    inputRef.current?.focus()
  }
  const replyRef = useRef(replyTo)
  replyRef.current = replyTo

  // Only the last PAGE messages at first: thousands of them in the page made every keystroke slow.
  // `from` stays null (follow the end) until you load older ones, then holds where the log starts, so
  // new words arriving do not push what you are reading out of the log.
  const [from, setFrom] = useState<number | null>(null)
  const start = from ?? startFor(view.chat, view.chat.length, PAGE)
  const startRef = useRef(start)
  startRef.current = start
  // The scroller keeps what you were reading in place when older messages appear above it.
  const loadOlder = () => setFrom(startFor(view.chat, start, PAGE))

  // Back to the quoted message: loaded first if it sits among the older ones, then centred and lit up.
  const [jump, setJump] = useState<number | null>(null)
  const [found, setFound] = useState<number | null>(null)
  const goToQuote = (q: Quote) => {
    const head = q.text.replace(/…$/, '').slice(0, 200)
    const chat = useApp.getState().view.chat
    let idx = -1
    for (let i = chat.length - 1; i >= 0 && idx < 0; i--) {
      const it = chat[i]!
      if ((it.kind === 'assistant' || it.kind === 'user') && splitQuote(it.text).body.includes(head)) idx = i
    }
    if (idx < 0) return
    setFrom((f) => Math.min(f ?? startRef.current, Math.max(0, idx - 2)))
    setJump(idx)
  }
  const goRef = useRef(goToQuote)
  goRef.current = goToQuote
  useLayoutEffect(() => {
    if (jump === null) return
    scroller.scrollToMessage(String(jump), { align: 'center', behavior: 'smooth' })
    setFound(jump)
    setJump(null)
  }, [jump, start, scroller])
  useEffect(() => {
    if (found === null) return
    const t = setTimeout(() => setFound(null), 1600)
    return () => clearTimeout(t)
  }, [found])

  const subagentName = (id: string) => {
    const m = view.subagents[id]
    return m ? profileFor(m.agentType, profiles).name : 'a subagent'
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId || !text.trim() || sending) return
    setSending(true)
    setError(null)
    setNote(external?.alive ? 'Relaying to the terminal session…' : null)
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
      if (r?.via === 'peer') setNote(`Relayed to ${r.to}. The reply will show up here.`)
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

  const feedback = (seq: number) =>
    sessionId && <FeedbackControl sessionId={sessionId} eventSeq={seq} commented={commented.has(seq)} onDone={() => setCommented((s) => new Set(s).add(seq))} />

  const render = (item: Exclude<ChatItem, ToolItem>, i: number): ReactNode => {
    switch (item.kind) {
      case 'user':
        return (
          <Message align="end">
            <MessageContent className="items-end gap-1">
              <Bubble variant="secondary" align="end">
                <BubbleContent className="flex flex-col gap-2 px-4 text-chat whitespace-pre-wrap">
                  <Said text={item.text} onQuote={(q) => goRef.current(q)} />
                </BubbleContent>
              </Bubble>
              <div className="-mr-1 flex flex-wrap items-center justify-end gap-1">
                <span className={ON_HOVER}>
                  <Time at={item.at} />
                </span>
                <ReplyButton onReply={(el) => replyRef.current('You', item.text, el)} />
                {feedback(item.seq)}
              </div>
            </MessageContent>
          </Message>
        )
      case 'assistant':
        return (
          <AgentMessage
            author={author}
            at={item.at}
            actions={
              <>
                <CopyButton text={item.text} className={ON_HOVER} />
                <ReplyButton onReply={(el) => replyRef.current(author, item.text, el)} />
                {feedback(item.seq)}
              </>
            }
          >
            <Md text={item.text} className="text-chat text-foreground" />
          </AgentMessage>
        )
      case 'summon':
        return (
          <Marker render={<button type="button" onClick={() => set({ selectedSubagent: item.subagentId })} />} className="ml-9 w-auto text-small hover:text-foreground">
            <MarkerIcon>
              <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.8} />
            </MarkerIcon>
            <MarkerContent className="flex-1">
              {author} started <span className="font-medium text-foreground">{subagentName(item.subagentId)}</span>
              {view.subagents[item.subagentId]?.description ? `: ${view.subagents[item.subagentId]!.description}` : ''}
            </MarkerContent>
            <Time at={item.at} />
          </Marker>
        )
      case 'done': {
        const m = view.subagents[item.subagentId]
        const ok = m?.status === 'completed'
        return (
          <Marker render={<button type="button" onClick={() => set({ selectedSubagent: item.subagentId })} />} className="ml-9 w-auto text-small hover:text-foreground">
            <MarkerIcon className={ok ? undefined : 'text-danger'}>
              <HugeiconsIcon icon={ok ? CheckmarkCircle02Icon : AlertCircleIcon} strokeWidth={1.8} />
            </MarkerIcon>
            <MarkerContent className="flex-1">
              <span className="font-medium text-foreground">{subagentName(item.subagentId)}</span> {ok ? 'finished' : `stopped: ${m?.status ?? 'unknown'}`}
            </MarkerContent>
            <Time at={item.at} />
          </Marker>
        )
      }
      case 'turn':
        return (
          <Marker variant="separator" className="text-meta tabular-nums">
            <MarkerContent>
              {(item.durationMs / 1000).toFixed(1)} s · about {formatCost(item.costUsdEquiv)} of quota
            </MarkerContent>
          </Marker>
        )
      case 'error':
        return (
          <Alert variant="destructive" className="ml-9 w-auto">
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.8} />
            <AlertDescription className="text-small whitespace-pre-wrap text-danger">{item.text}</AlertDescription>
          </Alert>
        )
    }
  }

  // Rendered once per change of the log, not on every keystroke in the textarea: a long session's
  // markdown would otherwise be parsed again for each letter typed. Consecutive tool calls share one trace.
  const log = useMemo(() => {
    const rows: ReactNode[] = []
    const items = view.chat
    for (let i = start; i < items.length; i++) {
      const item = items[i]!
      if (item.kind === 'tool') {
        if (HIDDEN_TOOLS.has(item.tool)) continue
        const first = i
        const tools: ToolItem[] = [item]
        while (i + 1 < items.length && items[i + 1]!.kind === 'tool') {
          const next = items[++i] as ToolItem
          if (!HIDDEN_TOOLS.has(next.tool)) tools.push(next)
        }
        rows.push(
          <MessageScrollerItem key={`t${first}`} messageId={`t${first}`} className={cn(live(item.at))}>
            <Trace className="gap-1 pl-9">
              {tools.map((t, j) => (
                <ToolLine key={j} item={t} />
              ))}
            </Trace>
          </MessageScrollerItem>,
        )
        continue
      }
      rows.push(
        <MessageScrollerItem
          key={i}
          messageId={String(i)}
          className={cn('rounded-xl transition-[background-color,box-shadow] duration-700', found === i && 'bg-muted/60 ring-8 ring-muted/60', live(item.at))}
        >
          {render(item, i)}
        </MessageScrollerItem>,
      )
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.chat, start, view.subagents, author, profiles, sessionId, commented, found])
  const hiddenOlder = useMemo(() => view.chat.slice(0, start).filter(visible).length, [view.chat, start])

  const empty = view.chat.length === 0 && !view.draft
  // What Claude last had in front of it: your message (it is reading it) or its own work.
  const lastSaid = view.chat.findLast(visible)
  const placeholder = external
    ? external.alive
      ? `Reply to ${author} (relayed to its terminal session)`
      : `Reply to ${author} (its terminal closed: replying resumes the session here)`
    : `Reply to ${author}, or type / for commands`

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Conversation with ${author}`}>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label={`Messages with ${author}`}>
          {hiddenOlder > 0 && (
            <div className="mx-auto w-full max-w-3xl px-8 pt-6">
              <Marker variant="separator" render={<button type="button" onClick={loadOlder} />} className="text-small hover:text-foreground">
                <MarkerContent>
                  Show {Math.min(PAGE, hiddenOlder)} earlier messages ({hiddenOlder} hidden)
                </MarkerContent>
              </Marker>
            </div>
          )}
          <MessageScrollerContent className="mx-auto w-full max-w-3xl px-8 py-6">
            {empty && (
              <MessageScrollerItem>
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <PebbleIcon sprite="icon-stone-flat" size={40} />
                    </EmptyMedia>
                    <EmptyTitle>No messages yet</EmptyTitle>
                    <EmptyDescription>Write to {author} below.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {log}
            {view.draft && (
              <MessageScrollerItem>
                <AgentMessage author={author}>
                  <Md text={view.draft} className="text-chat text-foreground" />
                </AgentMessage>
              </MessageScrollerItem>
            )}
            {view.busy && !view.draft && (
              <MessageScrollerItem>
                <Typing author={author} reading={lastSaid?.kind === 'user'} />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Jump to latest" className="rounded-full shadow-sm">
          <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
        </MessageScrollerButton>
      </MessageScroller>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-8 pb-6">
        {sessionId && queued.map((m) => <Queued key={m.id} sessionId={sessionId} author={author} m={m} />)}
        {external && (
          <p className="text-meta text-muted-foreground">
            {external.alive
              ? 'Started in a terminal. Your replies are relayed to that terminal session.'
              : 'Started in a terminal that has since closed. Replying here resumes the session in Sangha.'}
          </p>
        )}
        <form className="flex flex-col gap-2 rounded-xl border bg-surface p-3 transition-colors focus-within:border-ring/60" onSubmit={submit}>
          {quote && <QuoteBlock quote={quote} onClear={() => (setQuote(null), inputRef.current?.focus())} />}
          <Textarea
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
                // Sets aside what you are writing, without letting the browser open its "Save" dialog.
                e.preventDefault()
                stashCurrent()
              }
            }}
            placeholder={placeholder}
            disabled={!sessionId}
            readOnly={sending}
            rows={1}
            aria-label={`Message to ${author}`}
            className="max-h-60 min-h-6 resize-none rounded-none border-0 bg-transparent px-1 py-0 text-chat shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent md:text-chat dark:bg-transparent dark:disabled:bg-transparent"
          />
          <div className="flex items-center gap-1">
            <Tip
              label={
                withShot
                  ? 'Your latest screenshot goes with this message (taken when you send). Click to cancel.'
                  : `Attach your latest screenshot to the next message, so ${author} knows which image you mean`
              }
            >
              <Button type="button" variant={withShot ? 'secondary' : 'ghost'} size="sm" disabled={!sessionId || sending} onClick={() => setWithShot((on) => !on)} aria-pressed={withShot}>
                <HugeiconsIcon icon={Camera01Icon} strokeWidth={1.8} data-icon="inline-start" />
                {withShot ? 'Screenshot attached' : 'Screenshot'}
              </Button>
            </Tip>
            <Popover
              open={stashOpen}
              onOpenChange={(open) => {
                setStashOpen(open)
                if (open) setStashError(null)
              }}
            >
              <PopoverTrigger
                render={
                  <Button type="button" variant={stashOpen ? 'secondary' : 'ghost'} size="sm" disabled={!sessionId} title="Messages you set aside for later">
                    <HugeiconsIcon icon={Archive02Icon} strokeWidth={1.8} data-icon="inline-start" />
                    Set aside
                    {stash.length > 0 && (
                      <Badge variant="secondary" className="tabular-nums">
                        {stash.length}
                      </Badge>
                    )}
                  </Button>
                }
              />
              <PopoverContent side="top" align="start" className="w-80 gap-2" aria-label="Messages set aside">
                <Button type="button" variant="outline" size="sm" disabled={!text.trim()} onClick={stashCurrent} className="w-full justify-between">
                  Set aside what I'm writing
                  <Kbd>Ctrl S</Kbd>
                </Button>
                {stashError && (
                  <p role="alert" className="text-small text-danger">
                    {stashError}
                  </p>
                )}
                {stash.length === 0 ? (
                  <p className="px-1 py-2 text-small text-muted-foreground">Nothing set aside yet.</p>
                ) : (
                  <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                    {stash.map((it) => (
                      <li key={it.id} className="flex flex-col gap-1 rounded-lg px-2 py-2 hover:bg-muted/50">
                        <time className="text-meta text-muted-foreground">{clock(it.at)}</time>
                        <p className="line-clamp-3 text-small whitespace-pre-wrap">{it.text}</p>
                        <div className="-ml-2 flex items-center gap-1">
                          <Button type="button" variant="ghost" size="xs" onClick={() => resumeStashed(it)}>
                            Resume
                          </Button>
                          <Button type="button" variant="ghost" size="xs" disabled={stashBusyId === it.id} onClick={() => void sendStashed(it)}>
                            {stashBusyId === it.id ? 'Sending…' : 'Send'}
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label="Delete this set-aside message" title="Delete" onClick={() => deleteStashed(it)}>
                            <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            <div className="ml-auto flex items-center gap-2">
              {view.busy && sessionId && !external && (
                <Tip label="Interrupt">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="rounded-full"
                    aria-label="Interrupt"
                    onClick={() => {
                      // Mark before calling: no attention signal when the session stops because we asked it to.
                      useApp.getState().markInterrupted(sessionId)
                      void api.interrupt(sessionId)
                    }}
                  >
                    <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                  </Button>
                </Tip>
              )}
              <Tip label={view.busy ? 'Send (queued until this turn ends)' : 'Send'}>
                <Button type="submit" size="icon" className="rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={!sessionId || sending || !text.trim()} aria-label="Send">
                  <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
                </Button>
              </Tip>
            </div>
          </div>
        </form>
        {note && (
          <p role="status" className="text-small text-muted-foreground">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
