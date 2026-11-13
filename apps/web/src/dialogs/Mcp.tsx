import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { LibraryIcon } from '@hugeicons/core-free-icons'
import type { GlobalMcp, LibraryMcp } from '@sangha/shared'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Modal, message } from './Modal'

const LIBRARY_STATUS = (m: LibraryMcp): { label: string; tone: 'on' | 'off' | 'missing' } =>
  m.active ? { label: 'On', tone: 'on' } : m.missing ? { label: 'Missing credentials', tone: 'missing' } : { label: 'Off', tone: 'off' }

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  ) : null

const Loading = () => (
  <div className="flex items-center gap-2 text-small text-muted-foreground">
    <Spinner /> Loading
  </div>
)

/**
 * A server's credentials, pre-filled from what is already saved (secret fields stay empty, with a
 * placeholder saying so). `activateOnSave`: this form was opened to turn the server on, so saving also
 * activates it (the server refuses if a required field is still missing). Renders its own actions, so it
 * can sit inside any dialog body.
 */
export function LibraryCredentialsForm({
  mcp,
  activateOnSave,
  onCancel,
  onSaved,
}: {
  mcp: LibraryMcp
  activateOnSave: boolean
  onCancel: () => void
  onSaved: (list: LibraryMcp[]) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(mcp.fields.map((f) => [f.key, f.secret ? '' : (f.value ?? '')])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.setLibraryMcp(mcp.name, { values, ...(activateOnSave ? { active: true } : {}) }))
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <p className="text-small text-muted-foreground">
          Credentials for <span className="font-medium text-foreground">{mcp.name}</span>
          {activateOnSave && ', to turn it on'}.
        </p>
        {mcp.fields.map((f) => (
          <Field key={f.key}>
            <FieldLabel htmlFor={`mcp-field-${f.key}`}>
              {f.label}
              {f.optional && <span className="font-normal text-muted-foreground">(optional)</span>}
            </FieldLabel>
            <Input
              id={`mcp-field-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.secret ? (f.set ? 'Saved, leave empty to keep it' : f.placeholder) : f.placeholder}
              autoComplete="off"
            />
          </Field>
        ))}
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {activateOnSave ? 'Save and turn on' : 'Save'}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

/** MCP servers switched for all of Sangha: every session follows, unless it has its own switch (its MCP menu). */
export function McpDialog({ onClose, onLibrary }: { onClose: () => void; onLibrary: () => void }) {
  const [list, setList] = useState<GlobalMcp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => void api.globalMcp().then(setList, (e) => setError(message(e))), [])

  const toggle = (m: GlobalMcp) => {
    setBusy(m.name)
    setError(null)
    api
      .setGlobalMcp(m.name, !m.enabled)
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Modal
      title="MCP servers"
      description="For every session, except those with their own setting (a session's MCP menu)."
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onLibrary}>
          <HugeiconsIcon icon={LibraryIcon} data-icon="inline-start" />
          Sangha library
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorLine error={error} />
        {list === null && !error && <Loading />}
        {list && (
          <ItemGroup className="gap-0">
            {[...list]
              .sort((a, b) => Number(b.enabled) - Number(a.enabled))
              .map((m) => {
                const claudeAi = m.name.startsWith('claude.ai ')
                const plugin = /^plugin:[^:]+:(.+)$/.exec(m.name)?.[1]
                return (
                  <Item key={m.name} size="xs" className="px-2">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="text-ui font-normal" title={`Scope: ${m.scope}`}>
                        <span className="truncate">{claudeAi ? m.name.slice('claude.ai '.length) : (plugin ?? m.name)}</span>
                        {claudeAi && <Badge variant="secondary">claude.ai</Badge>}
                        {plugin && <Badge variant="secondary">plugin</Badge>}
                        {m.scope === 'library' && <Badge variant="secondary">Sangha</Badge>}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={m.enabled}
                        disabled={busy === m.name}
                        onCheckedChange={() => toggle(m)}
                        aria-label={`${m.enabled ? 'Turn off' : 'Turn on'} ${m.name}`}
                      />
                    </ItemActions>
                  </Item>
                )
              })}
          </ItemGroup>
        )}
      </div>
    </Modal>
  )
}

export function McpLibraryDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<LibraryMcp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // name mid-request, list view only
  const [editing, setEditing] = useState<{ mcp: LibraryMcp; activateOnSave: boolean } | null>(null)

  const reload = () => api.mcpLibrary().then(setList, (e) => setError(message(e)))
   
  useEffect(() => void reload(), [])

  const activate = (m: LibraryMcp) => {
    if (m.missing) return setEditing({ mcp: m, activateOnSave: true })
    setBusy(m.name)
    setError(null)
    api
      .setLibraryMcp(m.name, { active: true })
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  const deactivate = (m: LibraryMcp) => {
    setBusy(m.name)
    setError(null)
    api
      .setLibraryMcp(m.name, { active: false })
      .then(setList, (e) => setError(message(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Modal
      title="MCP library"
      description={editing ? undefined : 'MCP servers Sangha knows. Once turned on, they are on for every session (each session can turn one off for itself).'}
      onClose={onClose}
    >
      {!editing ? (
        <div className="flex flex-col gap-4">
          <ErrorLine error={error} />
          {list === null && !error && <Loading />}
          {list?.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>The library is empty</EmptyTitle>
                <EmptyDescription>No MCP servers are bundled with Sangha yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {list && list.length > 0 && (
            <ItemGroup className="gap-2">
              {list.map((m) => {
                const status = LIBRARY_STATUS(m)
                return (
                  <Item key={m.name} variant="outline">
                    <ItemContent className="min-w-0">
                      <ItemTitle>
                        {m.name}
                        <span className={cn('text-meta font-normal', status.tone === 'on' ? 'text-foreground' : status.tone === 'missing' ? 'text-amber' : 'text-muted-foreground')}>
                          {status.label}
                        </span>
                      </ItemTitle>
                      <ItemDescription className="text-small">{m.description}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="ghost" size="sm" disabled={busy === m.name} onClick={() => setEditing({ mcp: m, activateOnSave: false })}>
                        Credentials
                      </Button>
                      {m.active ? (
                        <Button variant="outline" size="sm" disabled={busy === m.name} onClick={() => deactivate(m)}>
                          {busy === m.name && <Spinner data-icon="inline-start" />}
                          Turn off
                        </Button>
                      ) : (
                        <Button size="sm" disabled={busy === m.name} onClick={() => activate(m)}>
                          {busy === m.name && <Spinner data-icon="inline-start" />}
                          Turn on
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          )}
          <FieldDescription className="text-meta">
            Servers stay on until Sangha restarts. Credentials are saved in <code className="font-mono">~/.config/sangha/.env</code>.
          </FieldDescription>
        </div>
      ) : (
        <LibraryCredentialsForm
          mcp={editing.mcp}
          activateOnSave={editing.activateOnSave}
          onCancel={() => setEditing(null)}
          onSaved={(l) => {
            setList(l)
            setEditing(null)
          }}
        />
      )}
    </Modal>
  )
}
