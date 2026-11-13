import type { BackgroundScript } from '@sangha/shared'
import { runningFor } from '@/lib/time'

/** One background script, folded to its gist: Haiku's sentence first, then how long it has run and the raw
 *  command in small mono underneath, so reading bash is never required. */
export function ScriptItem({ script, now }: { script: BackgroundScript; now: number }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border px-3 py-2">
      <p className="text-small">{script.summary ?? <span className="text-muted-foreground">Reading what this script does…</span>}</p>
      <p className="text-meta text-muted-foreground">{runningFor(script.since, now)}</p>
      <code className="truncate font-mono text-meta text-muted-foreground" title={script.command}>
        {script.command}
      </code>
    </li>
  )
}
