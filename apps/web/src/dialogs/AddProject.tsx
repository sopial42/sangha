import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Folder01Icon } from '@hugeicons/core-free-icons'
import type { ProjectSuggestion } from '@sangha/shared'
import { api } from '../api'
import { useApp } from '../store'
import { Modal, message } from './Modal'
import { shortenPath } from '@/lib/sessions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'

const FORM_ID = 'add-project-form'

export function AddProject({ onClose }: { onClose: () => void }) {
  const set = useApp((s) => s.set)
  const [mode, setMode] = useState<'local' | 'git'>('local')
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [found, setFound] = useState<ProjectSuggestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.suggestions().then(setFound, () => setFound([]))
  }, [])

  const add = async (src: { gitUrl: string } | { path: string }) => {
    setBusy(true)
    setError(null)
    try {
      await api.addProject(src, name || undefined)
      set({ projects: await api.projects() })
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add a project"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy || !source.trim()}>
            {busy && <Spinner data-icon="inline-start" />}
            {mode === 'local' ? 'Add' : 'Clone'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'local' | 'git')}>
          <TabsList aria-label="Project source" className="w-full">
            <TabsTrigger value="local">Folder on this machine</TabsTrigger>
            <TabsTrigger value="git">Git URL</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'local' && (
          <section aria-label="Detected repositories" className="flex flex-col gap-2">
            <p className="text-small text-muted-foreground">Repositories where Claude Code ran in the last 14 days:</p>
            {found === null && (
              <p className="flex items-center gap-2 text-small text-muted-foreground">
                <Spinner /> Searching…
              </p>
            )}
            {found?.length === 0 && <p className="text-small text-muted-foreground">No repository found.</p>}
            {found && found.length > 0 && (
              <ItemGroup className="gap-1">
                {found.map((f) => (
                  <Item
                    key={f.path}
                    size="sm"
                    variant="outline"
                    render={<button type="button" disabled={busy} onClick={() => void add({ path: f.path })} />}
                    className="text-left hover:bg-muted disabled:opacity-50"
                  >
                    <ItemMedia variant="icon">
                      <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.7} />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{f.name}</ItemTitle>
                      <ItemDescription className="truncate font-mono text-meta">{shortenPath(f.path)}</ItemDescription>
                    </ItemContent>
                    <ItemActions className="text-meta text-muted-foreground">
                      {new Date(f.lastUsed).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </section>
        )}

        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault()
            void add(mode === 'local' ? { path: source } : { gitUrl: source })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ap-source">{mode === 'local' ? 'Or a path' : 'Git repository URL'}</FieldLabel>
              <Input
                id="ap-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                required
                className="font-mono"
                placeholder={mode === 'local' ? '~/code/my-app' : 'git@github.com:me/my-app.git'}
              />
              <FieldDescription>
                {mode === 'local'
                  ? 'The folder stays where it is: Sangha works in worktrees next to it, without touching your copy.'
                  : 'The repository is cloned into workspaces/.'}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="ap-name">Name (optional)</FieldLabel>
              <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" />
            </Field>
            {error && (
              <p className="text-small text-danger" role="alert">
                {error}
              </p>
            )}
          </FieldGroup>
        </form>
      </div>
    </Modal>
  )
}
