import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, PlusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { providerEnv, shellExports, type Provider } from '@sangha/shared'
import { ApiError, api } from '@/api'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Modal, message } from './Modal'

const EMPTY_PROVIDER: Partial<Provider> = { name: '', baseUrl: '', apiKey: '', authToken: '', timeoutMs: 3_000_000, models: null }

/**
 * Endpoints Claude Code can run on instead of Claude (e.g. OVH AI endpoints): address and credentials set
 * once; Sangha sets every ANTHROPIC_* model variable to the model each session picks. Models: all those the
 * endpoint lists (kept current), or only the ones you tick.
 */
export function Providers({ onClose }: { onClose: () => void }) {
  const set = useApp((s) => s.set)
  const [list, setList] = useState<Provider[] | null>(null)
  const [edit, setEdit] = useState<Partial<Provider> | null>(null)
  const [found, setFound] = useState<string[] | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    api.providers().then(
      (l) => {
        setList(l)
        setError(null)
      },
      (e: unknown) => {
        setList([])
        setError(
          e instanceof ApiError && e.status === 404
            ? 'The server runs a version from before providers: restart it (make dev).'
            : `Could not read providers: ${message(e)}`,
        )
      },
    )
    // The model choices (top bar, new session, each session) follow.
    api.models().then((models) => set({ models }), () => undefined)
  }
  useEffect(reload, [set])

  const open = (p: Partial<Provider>) => {
    setEdit({ ...p })
    setFound(null)
    setExported(null)
    setError(null)
  }
  const field = (k: keyof Provider) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((p) => ({ ...p, [k]: e.target.value }))

  const probe = async () => {
    if (!edit?.baseUrl) return
    setBusy(true)
    setError(null)
    try {
      setFound(await api.probeModels({ baseUrl: edit.baseUrl, apiKey: edit.apiKey ?? '', authToken: edit.authToken ?? '' }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!edit) return
    setBusy(true)
    setError(null)
    try {
      await api.saveProvider(edit)
      setEdit(null)
      reload()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Provider) => {
    if (!confirm(`Remove ${p.name}? Its sessions will go back to Claude.`)) return
    await api.removeProvider(p.id).catch((e: Error) => setError(e.message))
    reload()
  }

  const chosen = edit?.models ?? null
  const toggle = (m: string) =>
    setEdit((p) => {
      const cur = p?.models ?? []
      return { ...p, models: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] }
    })
  // Everything to tick: what the endpoint lists, plus what you kept that it no longer lists.
  const tickable = [...new Set([...(found ?? []), ...(chosen ?? [])])].sort()

  const errorLine = error && (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  )

  if (!edit)
    return (
      <Modal
        title="Model providers"
        description="An Anthropic-compatible endpoint (e.g. OVH AI Endpoints) instead of Claude: set the address and credentials once, then pick the model for each session."
        onClose={onClose}
        footer={
          <Button onClick={() => open(EMPTY_PROVIDER)}>
            <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
            Add provider
          </Button>
        }
      >
        {error ? (
          errorLine
        ) : list === null ? (
          <div className="flex items-center gap-2 text-small text-muted-foreground">
            <Spinner /> Loading
          </div>
        ) : list.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No providers yet</EmptyTitle>
              <EmptyDescription>Every session runs on Claude.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {list.map((p) => (
              <Item key={p.id} variant="outline">
                <ItemContent className="min-w-0">
                  <ItemTitle>{p.name}</ItemTitle>
                  <ItemDescription className="truncate font-mono text-meta">{p.baseUrl}</ItemDescription>
                  <ItemDescription className="text-meta">
                    {p.models ? `${p.models.length} model${p.models.length === 1 ? '' : 's'} selected` : 'Every model the endpoint lists'}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" onClick={() => open(p)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(p)}>
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Modal>
    )

  return (
    <Modal
      title={edit.id ? `Edit ${edit.name || 'provider'}` : 'New provider'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => setEdit(null)}>
            Back
          </Button>
          <Button type="submit" form="provider-form" disabled={busy || (chosen !== null && chosen.length === 0)}>
            Save
          </Button>
        </>
      }
    >
      <form id="provider-form" onSubmit={save}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="provider-name">Name</FieldLabel>
            <Input id="provider-name" value={edit.name ?? ''} onChange={field('name')} required placeholder="OVH" />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
            <Input id="provider-url" value={edit.baseUrl ?? ''} onChange={field('baseUrl')} required placeholder="https://internal-ai.ovhcloud.tools/v1" />
            <FieldDescription className="font-mono text-meta">ANTHROPIC_BASE_URL</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-key">API key</FieldLabel>
            <Input id="provider-key" value={edit.apiKey ?? ''} onChange={field('apiKey')} placeholder="first.last@corp.ovh.com" autoComplete="off" />
            <FieldDescription className="font-mono text-meta">ANTHROPIC_API_KEY</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-token">Auth token (optional)</FieldLabel>
            <Input id="provider-token" value={edit.authToken ?? ''} onChange={field('authToken')} placeholder="not-really-needed" autoComplete="off" />
            <FieldDescription className="font-mono text-meta">ANTHROPIC_AUTH_TOKEN</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-timeout">Request timeout (ms)</FieldLabel>
            <Input id="provider-timeout" type="number" min={1000} value={edit.timeoutMs ?? 3_000_000} onChange={field('timeoutMs')} />
            <FieldDescription className="font-mono text-meta">API_TIMEOUT_MS</FieldDescription>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Models</FieldLegend>
            <RadioGroup
              value={chosen === null ? 'all' : 'some'}
              onValueChange={(v) => {
                if (v === 'all') setEdit((p) => ({ ...p, models: null }))
                else {
                  setEdit((p) => ({ ...p, models: p?.models ?? [] }))
                  if (!found) void probe()
                }
              }}
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="all" id="provider-models-all" />
                <FieldLabel htmlFor="provider-models-all" className="font-normal">
                  Every model the endpoint lists (kept up to date)
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="some" id="provider-models-some" />
                <FieldLabel htmlFor="provider-models-some" className="font-normal">
                  Only the ones I tick
                </FieldLabel>
              </Field>
            </RadioGroup>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={() => void probe()} disabled={busy || !edit.baseUrl}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? 'Asking the endpoint' : 'List the endpoint models'}
              </Button>
              {found && (
                <span className="text-small text-muted-foreground">
                  {found.length} model{found.length === 1 ? '' : 's'} found
                </span>
              )}
            </div>
            {tickable.length > 0 && (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {tickable.map((m) => (
                  <div key={m} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-muted">
                    <Field orientation="horizontal" className="min-w-0">
                      <Checkbox id={`provider-model-${m}`} disabled={chosen === null} checked={chosen === null || chosen.includes(m)} onCheckedChange={() => toggle(m)} />
                      <FieldLabel htmlFor={`provider-model-${m}`} className="truncate font-mono text-small font-normal">
                        {m}
                      </FieldLabel>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-pressed={exported === m}
                      onClick={() => setExported((x) => (x === m ? null : m))}
                      title="The variables to run Claude Code on this model in a terminal"
                    >
                      Exports
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {exported && edit.baseUrl && (
              <ShellSnippet
                title={`Claude Code on ${exported}, in a terminal`}
                text={shellExports(providerEnv({ baseUrl: edit.baseUrl, apiKey: edit.apiKey ?? '', authToken: edit.authToken ?? '', timeoutMs: Number(edit.timeoutMs) }, exported))}
              />
            )}
          </FieldSet>
          {errorLine}
        </FieldGroup>
      </form>
    </Modal>
  )
}

/** Shell lines to read and copy in one click. */
export function ShellSnippet({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
        <span className="truncate text-meta text-muted-foreground">{title}</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => void copy()}>
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} data-icon="inline-start" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-meta whitespace-pre">{text}</pre>
    </div>
  )
}
