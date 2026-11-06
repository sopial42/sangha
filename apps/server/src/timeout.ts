/**
 * Resolves or rejects along with `p`, unless `ms` elapses first: then rejects with `onTimeout()`'s error.
 * `p` itself is never cancelled (nothing here can reach into it); its eventual result is simply ignored.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
