import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { api, openSession } from '../api'
import { useApp } from '../store'
import { draftOf, NEW_PRIEST_DRAFT, saveDraft } from '../drafts'
import { Modal, message } from './Modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const FORM_ID = 'new-session-form'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function NewSession({ project: initial, onClose }: { project?: string; onClose: () => void }) {
  const projects = useApp((s) => s.projects)
  const [project, setProject] = useState(initial ?? projects[0]?.name ?? '')
  const p = projects.find((x) => x.name === project)
  const [agent, setAgent] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [baseRef, setBaseRef] = useState('')
  const models = useApp((s) => s.models)
  const defaultModel = useApp((s) => s.defaultModel)
  const [model, setModel] = useState(defaultModel)
  const [prompt, setPrompt] = useState(() => draftOf(NEW_PRIEST_DRAFT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Default to the project's own team lead when it ships one, else Sangha's.
    setAgent(p?.agents.find((a) => a.source === 'project' && /lead/i.test(a.id))?.id ?? 'lead')
    setBaseRef(p?.branch ?? '')
    setBranches([])
    if (p?.isGit) api.branches(p.name).then(setBranches, () => undefined)
  }, [p])

  const canSubmit = !busy && !!agent && !!project && !!prompt.trim()

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const s = await api.createSession({ project, agent, prompt, baseRef: baseRef || undefined, model: models.some((m) => m.id === model) ? model : '' })
      saveDraft(NEW_PRIEST_DRAFT, '')
      onClose()
      openSession(s.id)
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  const agents = p?.agents ?? []
  const branchList = p?.isGit ? (branches.length ? branches : [p.branch ?? 'HEAD']) : []
  const selectedModel = models.find((x) => x.id === model)
  const hasOptions = !!p?.isGit || models.length > 0

  return (
    <Modal
      title="New session"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!canSubmit}>
            {busy ? 'Starting…' : 'Start'}
            <KbdGroup className="ml-1">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>↵</Kbd>
            </KbdGroup>
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ns-project">Project</FieldLabel>
              <Select
                items={projects.map((x) => ({ value: x.name, label: x.name }))}
                value={project}
                onValueChange={(v) => v && setProject(v)}
              >
                <SelectTrigger id="ns-project" className="w-full">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((x) => (
                    <SelectItem key={x.name} value={x.name}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ns-agent">Agent</FieldLabel>
              <Select
                items={agents.map((a) => ({ value: a.id, label: a.title }))}
                value={agent}
                onValueChange={(v) => v && setAgent(v)}
              >
                <SelectTrigger id="ns-agent" className="w-full">
                  <SelectValue placeholder="Choose an agent" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} className="min-w-72">
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="items-start py-2">
                      <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
                        <span className="flex items-center gap-2">
                          {a.title}
                          {a.source === 'project' && <Badge variant="secondary">Project</Badge>}
                        </span>
                        <span className="text-meta text-muted-foreground">{a.description || a.id}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ns-prompt">Prompt</FieldLabel>
            <Textarea
              id="ns-prompt"
              autoFocus
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                saveDraft(NEW_PRIEST_DRAFT, e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void submit()
                }
              }}
              rows={6}
              required
              placeholder="What should this session do?"
              className="min-h-32 text-chat"
            />
          </Field>

          {hasOptions && (
            <Collapsible>
              <CollapsibleTrigger
                render={<Button type="button" variant="ghost" size="sm" className="group -ml-2 text-muted-foreground" />}
              >
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-start" className="transition-transform group-data-[panel-open]:rotate-180" />
                Options
              </CollapsibleTrigger>
              <CollapsibleContent>
                <FieldGroup className="pt-3">
                  {p?.isGit && (
                    <Field>
                      <FieldLabel htmlFor="ns-branch">Base branch</FieldLabel>
                      <Select items={branchList.map((b) => ({ value: b, label: b }))} value={baseRef} onValueChange={(v) => v && setBaseRef(v)}>
                        <SelectTrigger id="ns-branch" className="w-full font-mono">
                          <SelectValue placeholder={p.branch ?? 'HEAD'} />
                        </SelectTrigger>
                        <SelectContent>
                          {branchList.map((b) => (
                            <SelectItem key={b} value={b} className="font-mono">
                              {b}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>The session works in its own worktree, on a sangha/… branch.</FieldDescription>
                    </Field>
                  )}
                  {models.length > 0 && (
                    <Field>
                      <FieldLabel htmlFor="ns-model">Model</FieldLabel>
                      <Select items={models.map((x) => ({ value: x.id, label: x.label }))} value={model} onValueChange={(v) => v != null && setModel(v)}>
                        <SelectTrigger id="ns-model" className="w-full">
                          <SelectValue placeholder="Default model" />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((x) => (
                            <SelectItem key={x.id} value={x.id}>
                              {x.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedModel?.engine !== 'claude' && (
                        <FieldDescription>Outside your Claude subscription: it uses no quota and shows no cost.</FieldDescription>
                      )}
                    </Field>
                  )}
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          )}

          {error && (
            <p className="text-small text-danger" role="alert">
              {error}
            </p>
          )}
        </FieldGroup>
      </form>
    </Modal>
  )
}
