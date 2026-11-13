import { useState } from 'react'
import { api } from '@/api'
import { nameOf } from '@/lib/sessions'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Modal, message } from './Modal'

/** A loop's interval, as a fixed choice; "Custom" is typed free-form, validated by `CUSTOM_INTERVAL_RE`. */
const AUTONOMY_INTERVALS: Record<string, string> = { '5m': '5 min', '15m': '15 min', '1h': '1 h' }
const CUSTOM_INTERVAL_RE = /^\d+[smhd]$/
type Rhythm = 'auto' | '5m' | '15m' | '1h' | 'custom'
const RHYTHMS: { value: Rhythm; label: string }[] = [
  { value: 'auto', label: 'Its own pace' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 h' },
  { value: 'custom', label: 'Custom' },
]

/**
 * A session's autonomy: the one engine that keeps it going on its own, never both at once. A `/goal`
 * (turn after turn, until it is met) or a `/loop` (it wakes itself up, again and again, on the same
 * instruction). Opens on whichever it currently runs; both modes are prefilled with what it last had,
 * even stopped, so restarting or switching is quick. Starting one stops the other.
 */
export function AutonomyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useApp((s) => s.sessions[id])
  const current = session?.autonomy ?? null
  const [tab, setTab] = useState<'goal' | 'loop'>(current?.mode ?? 'goal')
  const [goalText, setGoalText] = useState(current?.mode === 'goal' ? current.text : '')
  const [loopText, setLoopText] = useState(current?.mode === 'loop' ? current.text : '')
  const [rhythm, setRhythm] = useState<Rhythm>(() => {
    if (current?.mode !== 'loop') return 'auto'
    const iv = current.interval
    if (iv === null) return 'auto'
    return iv === '5m' || iv === '15m' || iv === '1h' ? iv : 'custom'
  })
  const [customInterval, setCustomInterval] = useState(() => {
    if (current?.mode !== 'loop') return ''
    const iv = current.interval
    return iv && iv !== '5m' && iv !== '15m' && iv !== '1h' ? iv : ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  const interval = rhythm === 'auto' ? null : rhythm === 'custom' ? customInterval.trim() : rhythm
  const customInvalid = rhythm === 'custom' && !CUSTOM_INTERVAL_RE.test(customInterval.trim())

  const switchTab = (t: 'goal' | 'loop') => {
    setTab(t)
    setError(null)
  }

  const run = async (body: { mode: 'goal' | 'loop'; text: string; interval?: string | null } | null) => {
    setBusy(true)
    setError(null)
    try {
      await api.autonomy(id, body)
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  const launchGoal = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!goalText.trim()) return
    void run({ mode: 'goal', text: goalText.trim() })
  }

  const launchLoop = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!loopText.trim() || customInvalid) return
    void run({ mode: 'loop', text: loopText.trim(), interval })
  }

  // Plain Enter submits (as every other dialog's textarea here); Shift+Enter keeps its newline.
  const enterSubmits = (submit: () => void) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault()
      submit()
    }
  }

  const updating = !!current?.active && current.mode === tab
  const canLaunch = tab === 'goal' ? !!goalText.trim() : !!loopText.trim() && !customInvalid

  return (
    <Modal
      title="Autonomy"
      description={
        <>
          For <span className="font-medium text-foreground">{nameOf(session)}</span>. Interrupting it stops this too.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="autonomy-form" disabled={busy || !canLaunch}>
            {updating ? 'Update' : 'Start'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {current?.active && (
          <div className="flex items-center gap-3 rounded-lg border bg-secondary px-3 py-2">
            <p className="min-w-0 flex-1 text-small">
              <span className="text-muted-foreground">Running: </span>
              {current.mode === 'goal' ? (
                <>Goal: {current.text}</>
              ) : (
                <>
                  Loop: {current.text} <span className="text-muted-foreground">· {current.interval ? `every ${AUTONOMY_INTERVALS[current.interval] ?? current.interval}` : 'at its own pace'}</span>
                </>
              )}
            </p>
            <Button variant="outline" size="sm" onClick={() => void run(null)} disabled={busy}>
              Stop
            </Button>
          </div>
        )}

        <ToggleGroup
          variant="outline"
          spacing={0}
          value={[tab]}
          onValueChange={(v) => {
            const next = v[0] as 'goal' | 'loop' | undefined
            if (next) switchTab(next)
          }}
          aria-label="Autonomy mode"
        >
          <ToggleGroupItem value="goal" className="px-4">
            Goal
          </ToggleGroupItem>
          <ToggleGroupItem value="loop" className="px-4">
            Loop
          </ToggleGroupItem>
        </ToggleGroup>

        {tab === 'goal' ? (
          <form id="autonomy-form" onSubmit={launchGoal}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="autonomy-goal">What it should reach</FieldLabel>
                <Textarea
                  id="autonomy-goal"
                  autoFocus
                  className="min-h-32 text-small"
                  value={goalText}
                  rows={6}
                  placeholder="e.g. all tests pass and the PR is open"
                  onChange={(e) => setGoalText(e.target.value)}
                  onKeyDown={enterSubmits(() => launchGoal())}
                />
                <FieldDescription>
                  It keeps taking turns on its own until this is reached.
                  {current?.active && current.mode === 'loop' && ' Starting a goal stops the current loop.'}
                </FieldDescription>
              </Field>
              {error && (
                <p role="alert" className="text-small text-danger">
                  {error}
                </p>
              )}
            </FieldGroup>
          </form>
        ) : (
          <form id="autonomy-form" onSubmit={launchLoop}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="autonomy-loop">The instruction to repeat</FieldLabel>
                <Textarea
                  id="autonomy-loop"
                  autoFocus
                  className="min-h-32 text-small"
                  value={loopText}
                  rows={6}
                  placeholder="e.g. review the open PRs, restart the stuck jobs"
                  onChange={(e) => setLoopText(e.target.value)}
                  onKeyDown={enterSubmits(() => launchLoop())}
                />
                <FieldDescription>
                  It wakes itself up to start again, until you stop it.
                  {current?.active && current.mode === 'goal' && ' Starting a loop stops the current goal.'}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id="autonomy-interval-label">Interval</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={[rhythm]}
                    onValueChange={(v) => {
                      const next = v[0] as Rhythm | undefined
                      if (next) setRhythm(next)
                    }}
                    aria-labelledby="autonomy-interval-label"
                  >
                    {RHYTHMS.map((r) => (
                      <ToggleGroupItem key={r.value} value={r.value} className="px-3">
                        {r.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {rhythm === 'custom' && (
                    <Input
                      className="h-7 w-24 font-mono"
                      value={customInterval}
                      onChange={(e) => setCustomInterval(e.target.value)}
                      placeholder="90m"
                      aria-label="Custom interval"
                      aria-invalid={customInvalid}
                    />
                  )}
                </div>
                {rhythm === 'custom' && customInterval.length > 0 && customInvalid && <p className="text-small text-danger">A number followed by s, m, h or d (e.g. 90m).</p>}
              </Field>
              {error && (
                <p role="alert" className="text-small text-danger">
                  {error}
                </p>
              )}
            </FieldGroup>
          </form>
        )}
      </div>
    </Modal>
  )
}
