import { useState, type MouseEvent } from 'react'

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
    <button type="button" className={`copy-btn ${copied ? 'is-copied' : ''} ${className}`} onClick={copy} title={copied ? 'Copié' : 'Copier'} aria-label="Copier">
      {copied ? '✓' : (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
          <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  )
}
