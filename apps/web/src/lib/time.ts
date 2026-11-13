/** A log line's time in English: "14:05" today, "Nov 12, 14:05" on another day. */
export function clock(at: number) {
  if (!at) return ''
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

/** How long something has been running: "just started", "3 min", "2 h", "1 d". */
export function runningFor(since: number, now = Date.now()) {
  const min = Math.round(Math.max(0, now - since) / 60_000)
  if (min < 1) return 'just started'
  if (min < 60) return `running for ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `running for ${h} h` : `running for ${Math.round(h / 24)} d`
}

/** A date for lists: "Nov 13, 14:05", with the year when it isn't this one. */
export function dateTime(at: number) {
  if (!at) return ''
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
