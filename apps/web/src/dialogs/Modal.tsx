import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Every Sangha dialog: opens when mounted, closes (Escape, backdrop, ✕) through `onClose`.
 * `size`: sm 420px for confirmations, md 560px for forms (default), lg 760px for lists and tables.
 */
export function Modal({
  title,
  description,
  onClose,
  footer,
  size = 'md',
  className,
  children,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
  children: ReactNode
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          'flex max-h-[min(88dvh,860px)] flex-col gap-0 p-0',
          size === 'sm' && 'sm:max-w-[420px]',
          size === 'md' && 'sm:max-w-[560px]',
          size === 'lg' && 'sm:max-w-[760px]',
          className,
        )}
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-6 pt-5 pb-4">
          <DialogTitle className="text-title font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="text-small">{description}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <DialogFooter className="mx-0 mb-0 shrink-0 rounded-b-xl border-t px-6 py-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
