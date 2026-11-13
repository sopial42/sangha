import { Fragment, type ReactNode } from 'react'
import { CopyButton } from './CopyButton'
import { cn } from '@/lib/utils'

// Minimal, safe markdown for agent messages: paragraphs, bullet/numbered lists, headings, tables,
// **bold**, `code`, [links](https://…) and bare URLs, and fenced code blocks. Never injects raw HTML.

// Only web and mail links: a `javascript:` or `data:` URL stays plain text.
const LINK = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)(?:[^\s()]|\([^\s()]*\))*)\)/
// A bare URL, balanced parentheses included, without the punctuation that usually ends the sentence around it.
const BARE_URL = /https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))*(?:[^\s<>().,;:!?'"\]]|\([^\s<>()]*\))/

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-muted-foreground/50 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-foreground">
    {children}
  </a>
)

function inline(text: string): ReactNode[] {
  // Code first: a URL inside `code` stays code.
  const parts = new RegExp(`(\`[^\`]+\`|${LINK.source}|${BARE_URL.source}|\\*\\*[^*]+\\*\\*)`, 'g')
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(parts)) {
    const part = m[0]
    const i = m.index
    if (i > last) out.push(<Fragment key={last}>{text.slice(last, i)}</Fragment>)
    const link = LINK.exec(part)
    if (part.startsWith('`') && part.length > 1)
      out.push(
        <span key={i} className="group/code relative">
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.88em] [overflow-wrap:anywhere]">{part.slice(1, -1)}</code>
          <CopyButton
            text={part.slice(1, -1)}
            className="absolute -top-6 right-0 z-10 bg-card opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
          />
        </span>,
      )
    else if (link && link[0] === part) out.push(<Link key={i} href={link[2]!}>{inline(link[1]!)}</Link>)
    else if (part.startsWith('**')) out.push(<strong key={i}>{inline(part.slice(2, -2))}</strong>)
    else out.push(<Link key={i} href={part}>{part}</Link>)
    last = i + part.length
  }
  if (last < text.length) out.push(<Fragment key={last}>{text.slice(last)}</Fragment>)
  return out
}

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isSeparator = (line: string) => /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line) || /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

type Align = 'left' | 'center' | 'right' | undefined
const alignOf = (sep: string): Align => {
  const t = sep.trim()
  if (t.startsWith(':') && t.endsWith(':')) return 'center'
  if (t.endsWith(':')) return 'right'
  if (t.startsWith(':')) return 'left'
  return undefined
}

function Table({ head, align, rows }: { head: string[]; align: Align[]; rows: string[][] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="min-w-full border-collapse text-small">
        <thead className="bg-muted/50">
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{ textAlign: align[i] }} className="border-b px-3 py-2 text-left align-top font-medium whitespace-nowrap">
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {head.map((_, j) => (
                <td key={j} style={{ textAlign: align[j] }} className="px-3 py-2 text-left align-top">
                  {inline(r[j] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Inline markdown only (**bold**, `code`, links), for short texts inside a sentence. */
export function MdInline({ text }: { text: string }) {
  return <>{inline(text)}</>
}

export function Md({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let list: { ordered: boolean; start: number; items: string[] } | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} start={list.start} className="flex list-decimal flex-col gap-1 pl-6 marker:text-muted-foreground">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="flex list-disc flex-col gap-1 pl-6 marker:text-muted-foreground">
          {items}
        </ul>
      ),
    )
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim().startsWith('```')) {
      flushPara()
      flushList()
      const code: string[] = []
      while (++i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i]!)
      blocks.push(
        <div key={blocks.length} className="group/pre relative rounded-lg border bg-muted/40">
          <pre className="overflow-x-auto px-3 py-2 font-mono text-small leading-relaxed">{code.join('\n')}</pre>
          <CopyButton text={code.join('\n')} className="absolute top-1 right-1 bg-card opacity-0 transition-opacity group-hover/pre:opacity-100 focus-visible:opacity-100" />
        </div>,
      )
      continue
    }
    // A table: a header row, a |---| separator, then rows.
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      flushPara()
      flushList()
      const head = cells(line)
      const align = cells(lines[i + 1]!).map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isRow(lines[i]!)) rows.push(cells(lines[i++]!))
      i--
      blocks.push(<Table key={blocks.length} head={head} align={align} rows={rows} />)
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] }
      list.items.push(bullet ? bullet[1]! : numbered![2]!)
    } else if (heading) {
      flushPara()
      flushList()
      blocks.push(
        <h4 key={blocks.length} className="text-title font-semibold text-foreground">
          {inline(heading[1]!)}
        </h4>,
      )
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return <div className={cn('flex min-w-0 flex-col gap-3 wrap-break-word', className)}>{blocks}</div>
}
