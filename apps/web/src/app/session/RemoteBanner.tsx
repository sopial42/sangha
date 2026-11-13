import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon, Copy01Icon, QrCodeIcon, SmartPhone01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { QrCode } from './QrCode'

/**
 * While claude.ai (or the Claude app) holds the conversation: the link stays in view, not just copied once and
 * forgotten. Copy, open, a QR code for the phone in hand, and the one way back.
 */
export function RemoteBanner({ url, busy, onStop }: { url: string; busy: boolean; onStop: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [url])
  const copy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-8 pt-4">
      <section aria-live="polite" aria-label="Remote Control" className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <HugeiconsIcon icon={SmartPhone01Icon} strokeWidth={1.8} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-small font-medium">This conversation is driven from claude.ai</p>
          <p className="text-meta text-muted-foreground">Writing here stops Remote Control and brings the session back to Sangha.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={1.8} />
          </Button>
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show QR code" title="Show QR code" />}>
              <HugeiconsIcon icon={QrCodeIcon} strokeWidth={1.8} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto items-center p-3">
              <QrCode value={url} size={144} title="Scan to continue on your phone" />
              <PopoverDescription className="text-meta">Scan to continue on your phone</PopoverDescription>
            </PopoverContent>
          </Popover>
          <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={url} target="_blank" rel="noopener" title={url}>
            Open
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.8} data-icon="inline-end" />
          </a>
          <Button variant="outline" size="sm" onClick={onStop} disabled={busy}>
            Take back
          </Button>
        </div>
      </section>
    </div>
  )
}
