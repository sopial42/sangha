/**
 * Whether a session works, as told to the board. It is said to work at once, but to have stopped
 * only once it stayed still for `settleMs`: a background task that reports back wakes it a few
 * seconds after its turn ended, and that short pause must not notify you as if it were waiting for you.
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
