/**
 * Whether a priest works, as told to the monastery. He is said to work at once, but to have stopped
 * only once he stayed still for `settleMs`: a background task that reports back wakes him a few
 * seconds after his turn ended, and that short pause must not ring the bowl as if he waited for you.
 */
export class BusySettle {
  /** What was last told: he works (or has not been still long enough to say otherwise). */
  busy = false
  /** Nothing runs right now, told or not yet. */
  still = true
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private settleMs: number,
    private onChange: (busy: boolean) => void,
  ) {}

  /** `now`: a stop for good (the session closed), nothing can wake him: tell it without waiting. */
  set(busy: boolean, { now = false } = {}) {
    this.still = !busy
    clearTimeout(this.timer)
    this.timer = undefined
    if (busy || now) return this.tell(busy)
    if (this.busy) this.timer = setTimeout(() => this.tell(false), this.settleMs)
  }

  private tell(busy: boolean) {
    this.timer = undefined
    if (busy === this.busy) return
    this.busy = busy
    this.onChange(busy)
  }

  dispose() {
    clearTimeout(this.timer)
  }
}
