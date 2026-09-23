import { Fragment, type ReactNode } from 'react'

// Minimal, safe markdown for agent messages: paragraphs, bullet/numbered lists, headings, tables,
// **bold**, `code` and fenced code blocks. Never injects raw HTML.

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) return <strong key={i}>{part.slice(2, -2)}</strong>
    return <Fragment key={i}>{part}</Fragment>
  })
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
    <div className="md-table">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{ textAlign: align[i] }}>
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {head.map((_, j) => (
                <td key={j} style={{ textAlign: align[j] }}>
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

/** Inline markdown only (**bold**, `code`), for short texts inside a sentence. */
export function MdInline({ text }: { text: string }) {
  return <>{inline(text)}</>
}

export function Md({ text }: { text: string }) {
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
        <ol key={blocks.length} start={list.start}>
          {items}
        </ol>
      ) : (
        <ul key={blocks.length}>{items}</ul>
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
      blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>)
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
      blocks.push(<h4 key={blocks.length}>{inline(heading[1]!)}</h4>)
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
  return <div className="md">{blocks}</div>
}
