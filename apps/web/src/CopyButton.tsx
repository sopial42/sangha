import { useState, type MouseEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A small icon that copies `text` to the clipboard, then shows a tick for a moment. */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (e: MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn('text-muted-foreground hover:text-foreground', className)}
      onClick={copy}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {/* Keyed: the tick replaces the copy icon with a short blur-and-scale, so the swap reads as one change. */}
      <HugeiconsIcon
        key={copied ? 'copied' : 'copy'}
        icon={copied ? Tick02Icon : Copy01Icon}
        strokeWidth={1.8}
        className="transition-[opacity,scale,filter] duration-150 ease-out-strong starting:scale-75 starting:opacity-0 starting:blur-[2px]"
      />
    </Button>
  )
}
