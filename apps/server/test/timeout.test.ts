import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../src/timeout'

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the promise when it settles before the delay', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, () => new Error('trop long'))).resolves.toBe('ok')
  })

  it('rejects with the timeout error once the delay elapses first', async () => {
    const never = new Promise<string>(() => {})
    const p = withTimeout(never, 1000, () => new Error('trop long'))
    const assertion = expect(p).rejects.toThrow('trop long')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('propagates the original rejection when it comes before the delay', async () => {
    const p = withTimeout(Promise.reject(new Error('échec du modèle')), 1000, () => new Error('trop long'))
    await expect(p).rejects.toThrow('échec du modèle')
  })
})
