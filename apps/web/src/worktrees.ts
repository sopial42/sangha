import { useEffect, useState } from 'react'
import type { ProjectWorktrees } from '@sangha/shared'
import { api } from './api'
import { useApp } from './store'

const REFRESH_MS = 15_000
/** A burst of session/removed events (several priests starting or leaving at once) settles into one reload. */
const DEBOUNCE_MS = 1_200

/**
 * Every project's worktrees, kept roughly current while `enabled` (the prayer flags are on): loaded
 * once, then refreshed on a slow timer and, sooner, shortly after any session appears or disappears.
 * Returns an empty list while disabled, so callers never render stale flags for an off scene.
 */
export function useWorktrees(enabled: boolean): ProjectWorktrees[] {
  const [flags, setFlags] = useState<ProjectWorktrees[]>([])
  const worktreesTick = useApp((s) => s.worktreesTick)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => void api.worktrees().then((w) => alive && setFlags(w), () => undefined)
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const t = setTimeout(() => void api.worktrees().then((w) => alive && setFlags(w), () => undefined), DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, worktreesTick])

  return enabled ? flags : []
}
