import { lazy, Suspense } from 'react'
import { useApp } from '../store'

// Dialogs load on first open: they are most of the UI code and none is needed to show the board.
const NewSession = lazy(() => import('./NewSession').then((m) => ({ default: m.NewSession })))
const AddProject = lazy(() => import('./AddProject').then((m) => ({ default: m.AddProject })))
const Dismiss = lazy(() => import('./Dismiss').then((m) => ({ default: m.Dismiss })))
const NoteEditor = lazy(() => import('./NoteEditor').then((m) => ({ default: m.NoteEditor })))
const RemoveProject = lazy(() => import('./RemoveProject').then((m) => ({ default: m.RemoveProject })))
const ClosedSessions = lazy(() => import('./ClosedSessions').then((m) => ({ default: m.ClosedSessions })))
const Costs = lazy(() => import('./Costs').then((m) => ({ default: m.Costs })))
const McpDialog = lazy(() => import('./Mcp').then((m) => ({ default: m.McpDialog })))
const McpLibraryDialog = lazy(() => import('./Mcp').then((m) => ({ default: m.McpLibraryDialog })))
const ElderDialog = lazy(() => import('./Elder').then((m) => ({ default: m.ElderDialog })))
const EnvDialog = lazy(() => import('./Env').then((m) => ({ default: m.EnvDialog })))
const ShepherdDialog = lazy(() => import('./Shepherd').then((m) => ({ default: m.ShepherdDialog })))
const AutonomyDialog = lazy(() => import('./Autonomy').then((m) => ({ default: m.AutonomyDialog })))
const GitIdentityDialog = lazy(() => import('./GitIdentity').then((m) => ({ default: m.GitIdentityDialog })))
const Providers = lazy(() => import('./Providers').then((m) => ({ default: m.Providers })))
const HostDialog = lazy(() => import('../host/HostDialog').then((m) => ({ default: m.HostDialog })))

export function Dialogs() {
  const dialog = useApp((s) => s.dialog)
  const set = useApp((s) => s.set)
  if (!dialog) return null
  return <Suspense fallback={null}>{pick(dialog, () => set({ dialog: null }), set)}</Suspense>
}

function pick(dialog: NonNullable<ReturnType<typeof useApp.getState>['dialog']>, close: () => void, set: ReturnType<typeof useApp.getState>['set']) {
  switch (dialog.kind) {
    case 'new-session':
      return <NewSession project={dialog.project} onClose={close} />
    case 'add-project':
      return <AddProject onClose={close} />
    case 'remove-project':
      return <RemoveProject name={dialog.name} onClose={close} />
    case 'note':
      return <NoteEditor id={dialog.id} lotus={dialog.lotus} onClose={close} />
    case 'nirvana':
      return <ClosedSessions onClose={close} />
    case 'costs':
      return <Costs onClose={close} />
    case 'providers':
      return <Providers onClose={close} />
    case 'git':
      return <GitIdentityDialog onClose={close} />
    case 'shepherd':
      return <ShepherdDialog id={dialog.id} onClose={close} />
    case 'env':
      return <EnvDialog id={dialog.id} onClose={close} />
    case 'autonomy':
      return <AutonomyDialog id={dialog.id} onClose={close} />
    case 'host':
      return <HostDialog onClose={close} />
    case 'mcp':
      return <McpDialog onClose={close} onLibrary={() => set({ dialog: { kind: 'mcp-library' } })} />
    case 'mcp-library':
      // Reached from the MCP dialog: closing it goes back there.
      return <McpLibraryDialog onClose={() => set({ dialog: { kind: 'mcp' } })} />
    case 'dismiss':
      return <Dismiss id={dialog.id} onClose={close} />
    case 'elder':
      return <ElderDialog onClose={close} />
  }
}
