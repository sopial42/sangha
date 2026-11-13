import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * A URL as a scannable code, inline SVG (no network round-trip, no image to fail loading). Dark
 * modules on a light quiet zone regardless of theme: that contrast is what a phone camera needs,
 * not the app palette.
 */
export function QrCode({ value, size = 112, title }: { value: string; size?: number; title?: string }) {
  const { count, margin, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    const m = 2 // quiet zone, in modules
    const d: string[] = []
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d.push(`M${col + m},${row + m}h1v1h-1z`)
      }
    }
    return { count: n, margin: m, path: d.join('') }
  }, [value])

  const side = count + margin * 2
  return (
    <svg viewBox={`0 0 ${side} ${side}`} width={size} height={size} role="img" aria-label={title ?? 'QR code'} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#f3e9d8" />
      <path d={path} fill="#1a1421" />
    </svg>
  )
}
