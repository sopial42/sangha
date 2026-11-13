import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon, ThumbsDownIcon, ThumbsUpIcon } from '@hugeicons/core-free-icons'
import type { ElderSettingsPatch, ElderState, ElderTopic, ElderTopicStatus } from '@sangha/shared'
import { api, openSession } from '@/api'
import { nameOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Modal, message } from './Modal'
import { clock } from '@/lib/time'

const ELDER_STATUS_LABEL: Record<ElderTopicStatus | 'all', string> = { all: 'All', proposed: 'Proposed', accepted: 'Accepted', rejected: 'Rejected', done: 'Done' }
const ELDER_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ELDER_LEVEL_LABEL: Record<'manual' | 'sangha' | 'project', string> = { manual: 'Manual feedback', sangha: 'Sangha', project: 'Projects' }
const REPORT_KIND: Record<ElderState['reports'][number]['kind'], string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  conversation: 'End of conversation',
  manual: 'Run now',
  skipped: 'Week skipped',
}

/** 'manual' → Manual feedback, 'sangha' → Sangha, 'project:<name>' → Project <name>. */
function elderScopeLabel(scope: string): string {
  if (scope === 'manual') return 'Manual feedback'
  if (scope === 'sangha') return 'Sangha'
  const project = /^project:(.+)$/.exec(scope)?.[1]
  return project ? `Project ${project}` : scope
}

/** A topic's evidence: a link to the conversation when it's a session still known here, a quiet word otherwise. */
export function ElderEvidence({ evidence }: { evidence: string[] }) {
  const sessions = useApp((s) => s.sessions)
  if (!evidence.length) return null
  return (
    <p className="text-meta text-muted-foreground">
      Evidence:{' '}
      {evidence.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          {sessions[id] ? (
            <button type="button" className="text-foreground underline-offset-4 hover:underline" onClick={() => openSession(id)}>
              {nameOf(sessions[id]!)}
            </button>
          ) : (
            'a feedback note'
          )}
        </span>
      ))}
    </p>
  )
}

/**
 * The Advisor's panel: its topics grouped by where they come from, its latest reports, a plain chat
 * with it, and its settings. Every setting is a real control (a model picker shared with a session's
 * own, the projects you actually follow as checkboxes, a day and an hour for the weekly pass), never a
 * raw string to type by hand.
 */
export function ElderDialog({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const models = useApp((s) => s.models)
  const elderBadge = useApp((s) => s.elderBadge)
  const [state, setState] = useState<ElderState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'topics' | 'reports' | 'chat' | 'settings'>('topics')
  const [statusFilter, setStatusFilter] = useState<ElderTopicStatus | 'all'>('all')
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [running, setRunning] = useState(false)

  const load = () => api.elder().then(setState, (e: unknown) => setError(message(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])
  // Its badge changed (a pass started, ended, or a topic count moved): the open panel follows along.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void (state && load()), [elderBadge?.proposed, elderBadge?.running])

  const vote = (id: string, v: 'up' | 'down') => api.voteElderTopic(id, v).then(load, (e: unknown) => setError(message(e)))
  const markDone = (id: string) => api.doneElderTopic(id).then(load, (e: unknown) => setError(message(e)))
  const runNow = async () => {
    setRunning(true)
    setError(null)
    try {
      await api.runElderNow()
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setRunning(false)
    }
  }
  const sendChat = async () => {
    const text = chatText.trim()
    if (!text) return
    setChatBusy(true)
    setError(null)
    try {
      await api.askElder(text)
      setChatText('')
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setChatBusy(false)
    }
  }
  const saveSettings = (patch: ElderSettingsPatch) => api.saveElderSettings(patch).then(load, (e: unknown) => setError(message(e)))
  const toggleProject = (name: string) => {
    if (!state) return
    const next = state.settings.projects.includes(name) ? state.settings.projects.filter((p) => p !== name) : [...state.settings.projects, name]
    saveSettings({ projects: next })
  }

  if (!state)
    return (
      <Modal onClose={onClose} title="Advisor" size="lg">
        {error ? (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-small text-muted-foreground">
            <Spinner /> Loading
          </div>
        )}
      </Modal>
    )

  const byScope = (topics: ElderTopic[]) => {
    const groups = new Map<string, ElderTopic[]>()
    for (const t of topics) groups.set(t.scope, [...(groups.get(t.scope) ?? []), t])
    return [...groups.entries()]
  }
  const topics = state.topics.filter((t) => statusFilter === 'all' || t.status === statusFilter)
  const engine = state.settings.model.includes('::') ? 'provider' : 'claude'
  const busyRunning = state.running || running
  const modelItems = [
    ...(models.some((m) => m.id === state.settings.model) ? [] : [{ value: state.settings.model, label: state.settings.model }]),
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ]
  const weekdayItems = ELDER_WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))

  return (
    <Modal
      onClose={onClose}
      title="Advisor"
      size="lg"
      description="Reads your feedback and proposes topics worth working on."
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border bg-secondary px-3 py-2">
          <p className="min-w-0 flex-1 text-small">
            {state.running
              ? 'Reviewing right now.'
              : state.settings.enabled
                ? `Next pass: ${state.nextRunAt ? clock(state.nextRunAt) : 'not scheduled yet'}`
                : 'Turned off for now.'}
          </p>
          <Button variant="outline" size="sm" disabled={busyRunning} onClick={() => void runNow()}>
            {busyRunning && <Spinner data-icon="inline-start" />}
            {busyRunning ? 'Running' : 'Run now'}
          </Button>
        </div>
        {state.lastError && (
          <p role="alert" className="text-small text-danger">
            Last Advisor error: {state.lastError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-4">
          <TabsList aria-label="Advisor sections">
            <TabsTrigger value="topics" className="px-3">
              Topics
            </TabsTrigger>
            <TabsTrigger value="reports" className="px-3">
              Reports
            </TabsTrigger>
            <TabsTrigger value="chat" className="px-3">
              Chat
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-3">
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="topics" className="flex flex-col gap-4">
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[statusFilter]}
              onValueChange={(v) => {
                const next = v[0] as ElderTopicStatus | 'all' | undefined
                if (next) setStatusFilter(next)
              }}
              aria-label="Filter topics by status"
            >
              {(['all', 'proposed', 'accepted', 'rejected', 'done'] as const).map((f) => (
                <ToggleGroupItem key={f} value={f} className="px-3">
                  {ELDER_STATUS_LABEL[f]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {topics.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No {statusFilter === 'all' ? '' : `${ELDER_STATUS_LABEL[statusFilter].toLowerCase()} `}topics yet</EmptyTitle>
                  <EmptyDescription>The Advisor proposes topics after each pass.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              byScope(topics).map(([scope, list]) => (
                <section key={scope} className="flex flex-col gap-2">
                  <h3 className="text-meta font-semibold text-muted-foreground">{elderScopeLabel(scope)}</h3>
                  <ItemGroup className="gap-2">
                    {list.map((t) => (
                      <Item key={t.id} variant="outline" className="items-start">
                        <ItemContent className="min-w-0">
                          <ItemTitle className="line-clamp-none">
                            {t.title}
                            <span className="text-meta font-normal text-muted-foreground">{ELDER_STATUS_LABEL[t.status]}</span>
                          </ItemTitle>
                          <ItemDescription className="line-clamp-none text-small whitespace-pre-wrap">{t.detail}</ItemDescription>
                          <ElderEvidence evidence={t.evidence} />
                        </ItemContent>
                        <ItemActions>
                          {t.status === 'accepted' && (
                            <Button variant="ghost" size="sm" onClick={() => markDone(t.id)}>
                              Mark done
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={cn(t.status === 'accepted' && 'bg-secondary text-foreground')}
                            onClick={() => vote(t.id, 'up')}
                            aria-pressed={t.status === 'accepted'}
                            aria-label="Accept this topic"
                          >
                            <HugeiconsIcon icon={ThumbsUpIcon} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={cn(t.status === 'rejected' && 'bg-secondary text-foreground')}
                            onClick={() => vote(t.id, 'down')}
                            aria-pressed={t.status === 'rejected'}
                            aria-label="Reject this topic"
                          >
                            <HugeiconsIcon icon={ThumbsDownIcon} />
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </section>
              ))
            )}
          </TabsContent>

          <TabsContent value="reports">
            {state.reports.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No reports yet</EmptyTitle>
                  <EmptyDescription>Each pass leaves a short report here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-2">
                {state.reports.map((r) => (
                  <Item key={r.id} variant="outline" className="items-start">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="text-meta font-normal text-muted-foreground">
                        <time>{clock(r.createdAt)}</time>
                        <span>· {REPORT_KIND[r.kind]}</span>
                      </ItemTitle>
                      <p className="text-small whitespace-pre-wrap">{r.text}</p>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </TabsContent>

          <TabsContent value="chat" className="flex flex-col gap-4">
            {state.chat.length === 0 ? (
              <p className="text-small text-muted-foreground">Nothing said yet: ask it a question.</p>
            ) : (
              <BubbleGroup>
                {state.chat.map((h) => (
                  <Bubble key={h.id} align={h.role === 'user' ? 'end' : 'start'} variant={h.role === 'user' ? 'secondary' : 'ghost'}>
                    <BubbleContent className="text-chat whitespace-pre-wrap">{h.text}</BubbleContent>
                  </Bubble>
                ))}
              </BubbleGroup>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void sendChat()
              }}
            >
              <Input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Ask the Advisor a question" disabled={chatBusy} aria-label="Message to the Advisor" />
              <Button type="submit" disabled={chatBusy || !chatText.trim()}>
                {chatBusy ? <Spinner data-icon="inline-start" /> : <HugeiconsIcon icon={SentIcon} data-icon="inline-start" />}
                Send
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="settings">
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="elder-enabled">On</FieldLabel>
                  <FieldDescription>Runs passes on the schedule below.</FieldDescription>
                </FieldContent>
                <Switch id="elder-enabled" checked={state.settings.enabled} onCheckedChange={(checked) => saveSettings({ enabled: checked })} />
              </Field>
              <Field>
                <FieldLabel>Model</FieldLabel>
                <Select items={modelItems} value={state.settings.model} onValueChange={(v) => v != null && saveSettings({ model: v as string })}>
                  <SelectTrigger className="w-full" aria-label="Advisor model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelItems.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {engine === 'claude'
                    ? 'On your subscription: a weekly pass, kept under the quota limit.'
                    : 'On a provider: a daily pass, plus one at the end of a conversation that has unhandled feedback.'}
                </FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">What it reads</FieldLegend>
                {(['manual', 'sangha', 'project'] as const).map((lvl) => (
                  <Field key={lvl} orientation="horizontal">
                    <Checkbox id={`elder-level-${lvl}`} checked={state.settings.levels[lvl]} onCheckedChange={(checked) => saveSettings({ levels: { [lvl]: checked } })} />
                    <FieldLabel htmlFor={`elder-level-${lvl}`} className="font-normal">
                      {ELDER_LEVEL_LABEL[lvl]}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldSet>
              {state.settings.levels.project && (
                <FieldSet>
                  <FieldLegend variant="label">Projects it follows</FieldLegend>
                  {projects.length === 0 ? (
                    <FieldDescription>No projects yet.</FieldDescription>
                  ) : (
                    projects.map((p) => (
                      <Field key={p.name} orientation="horizontal">
                        <Checkbox id={`elder-project-${p.name}`} checked={state.settings.projects.includes(p.name)} onCheckedChange={() => toggleProject(p.name)} />
                        <FieldLabel htmlFor={`elder-project-${p.name}`} className="font-normal">
                          {p.name}
                        </FieldLabel>
                      </Field>
                    ))
                  )}
                </FieldSet>
              )}
              <Field>
                <FieldLabel htmlFor="elder-daily">Daily time</FieldLabel>
                <Input id="elder-daily" type="time" className="w-32" value={state.settings.dailyAt} onChange={(e) => saveSettings({ dailyAt: e.target.value })} />
                <FieldDescription>Used with a provider model.</FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Weekly pass</FieldLegend>
                <FieldDescription>Used with a Claude model.</FieldDescription>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field>
                    <FieldLabel>Day</FieldLabel>
                    <Select items={weekdayItems} value={String(state.settings.weekly.day)} onValueChange={(v) => v != null && saveSettings({ weekly: { day: Number(v) } })}>
                      <SelectTrigger className="w-full" aria-label="Weekly pass day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {weekdayItems.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="elder-weekly-at">Time</FieldLabel>
                    <Input id="elder-weekly-at" type="time" value={state.settings.weekly.at} onChange={(e) => saveSettings({ weekly: { at: e.target.value } })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="elder-quota">Max quota used (%)</FieldLabel>
                    <Input
                      id="elder-quota"
                      type="number"
                      min={0}
                      max={100}
                      value={state.settings.weekly.maxWeekUsedPct}
                      onChange={(e) => saveSettings({ weekly: { maxWeekUsedPct: Number(e.target.value) } })}
                    />
                  </Field>
                </div>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="elder-max-chars">Context limit (characters)</FieldLabel>
                <Input
                  id="elder-max-chars"
                  type="number"
                  className="w-40"
                  min={1000}
                  step={1000}
                  value={state.settings.maxInputChars}
                  onChange={(e) => saveSettings({ maxInputChars: Number(e.target.value) })}
                />
                <FieldDescription>The most text sent to the model in one pass.</FieldDescription>
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>
      </div>
    </Modal>
  )
}
