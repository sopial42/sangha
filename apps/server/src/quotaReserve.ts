import type { Quota, QuotaReserve, QuotaReserveState, QuotaWindow } from '@sangha/shared'

/** A tenth of the plan quota kept untouched, until you choose otherwise. */
export const DEFAULT_RESERVE: QuotaReserve = { enabled: true, pct: 10 }

/** Whether a window counts towards the reserve: it must exist, and not have just started afresh. */
const counts = (w: QuotaWindow | null | undefined, nowSec: number): w is QuotaWindow => !!w && (w.resetsAt == null || w.resetsAt > nowSec)

/**
 * Whether the reserve bites right now, on the week (the only window the plan still reports). It only
 * counts if it exists and its `resetsAt` is null or still ahead: one just passed means the SDK is about
 * to report a fresh window, so holding priests on that stale number would be wrong. Reached: the reserve
 * is on and the week's usage reaches 100 - pct %.
 */
export function reserveState(reserve: QuotaReserve, quota: Quota | null, nowSec: number): QuotaReserveState {
  const reached = reserve.enabled && counts(quota?.sevenDay, nowSec) && quota!.sevenDay!.utilization * 100 >= 100 - reserve.pct
  return { ...reserve, reached, window: reached ? 'sevenDay' : null }
}

/** Merges a patch onto a reserve and checks it is sound; throws a plain Error (turned into a UserError by callers) otherwise. */
function validate(reserve: QuotaReserve): QuotaReserve {
  if (typeof reserve.enabled !== 'boolean') throw new Error('enabled doit être vrai ou faux')
  if (!Number.isInteger(reserve.pct) || reserve.pct < 0 || reserve.pct > 50) throw new Error('pct doit être un entier entre 0 et 50')
  return reserve
}

/** The share of the plan quota you ask Sangha to always keep unused, persisted across restarts (see `Store.setting`). */
export class QuotaReserveSetting {
  constructor(
    private read: () => QuotaReserve | null,
    private write: (v: QuotaReserve) => void,
  ) {}

  get(): QuotaReserve {
    return this.read() ?? DEFAULT_RESERVE
  }

  /** Validates a partial change merged onto the current reserve, persists it, and returns it. */
  set(patch: Partial<QuotaReserve>): QuotaReserve {
    const next = validate({ ...this.get(), ...patch })
    this.write(next)
    return next
  }
}

/** Shown to a held priest (his session's own error event, and his tools' denial reason) and announced in his session. */
export function reserveMessage(state: QuotaReserveState, quota: Quota | null): string {
  const resetsAt = state.window ? (quota?.[state.window]?.resetsAt ?? null) : null
  const until = resetsAt ? new Date(resetsAt * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'la prochaine fenêtre'
  return `Réserve de quota atteinte (${state.pct} % gardés) : prêtre mis en pause jusqu'à ${until}.`
}
