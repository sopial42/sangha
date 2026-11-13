import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon } from '@hugeicons/core-free-icons'
import type { McpServer } from '@sangha/shared'
import { api, ApiError } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

const MCP_STATUS_LABEL: Record<McpServer['status'], string> = {
  connected: 'Connected',
  failed: 'Failed',
  'needs-auth': 'Needs sign-in',
  pending: 'Connecting…',
  disabled: 'Off',
  off: 'Not loaded',
}

// A server not currently loaded for this session: the switch reads "off" either way (switched off, or simply
// never loaded from the user's Claude config).
const mcpOff = (s: McpServer) => s.status === 'disabled' || s.status === 'off'

/**
 * One MCP server row: name (claude.ai, plugin and Sangha ones get a small tag), status, and this session's
 * switch (marked, with a way back to the setting for all of Sangha, when the session has its own).
 */
function McpRow({ server, busy, onToggle, onReset, onLogin }: { server: McpServer; busy: boolean; onToggle: () => void; onReset: () => void; onLogin: () => void }) {
  const claudeAi = server.name.startsWith('claude.ai ')
  const plugin = /^plugin:[^:]+:(.+)$/.exec(server.name)?.[1]
  const sangha = server.scope === 'library'
  const name = claudeAi ? server.name.slice('claude.ai '.length) : (plugin ?? server.name)
  const on = server.session ?? server.global
  const own = server.session !== undefined
  return (
    <li className="flex items-center gap-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-small font-medium" title={`Scope: ${server.scope}`}>
            {name}
          </span>
          {claudeAi && <Badge variant="outline">claude.ai</Badge>}
          {plugin && <Badge variant="outline">plugin</Badge>}
          {sangha && <Badge variant="outline">Sangha</Badge>}
        </span>
        <span className="flex items-center gap-1">
          {server.status === 'needs-auth' ? (
            // Opens your browser on its sign-in page; the row stays busy until you authorized there.
            <Button variant="outline" size="xs" onClick={onLogin} disabled={busy} title="Opens the sign-in page in your browser">
              {busy ? 'Authorize in your browser…' : 'Sign in'}
            </Button>
          ) : (
            <Badge variant={server.status === 'failed' ? 'destructive' : 'secondary'} title={server.error}>
              {server.status === 'pending' && <Spinner className="size-3" aria-hidden />}
              {MCP_STATUS_LABEL[server.status]}
            </Badge>
          )}
          {own && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onReset} disabled={busy} title="Go back to the setting for all of Sangha">
              This session only · Reset
            </Button>
          )}
        </span>
      </div>
      <Switch checked={on} onCheckedChange={onToggle} disabled={busy} aria-label={`${on ? 'Turn off' : 'Turn on'} ${server.name}`} />
    </li>
  )
}

/**
 * MCP servers for this session, in a popover: fetched lazily (waking the session's process) on first open, with a
 * per-row switch that swaps the whole list in from the backend once it answers. Closed and reopened freely; only a
 * session change or Refresh fetches again.
 */
export function McpPanel({ sessionId, open, onToggleOpen, onClose }: { sessionId: string; open: boolean; onToggleOpen: () => void; onClose: () => void }) {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // name of the server mid-toggle, if any

  // A different session: forget what we knew, fetch fresh next time the popover opens.
  useEffect(() => {
    setServers(null)
    setError(null)
    setBusy(null)
  }, [sessionId])

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .mcpServers(sessionId)
      .then(setServers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not reach the session.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open && servers === null && !loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId])

  const toggle = (server: McpServer, enabled: boolean | null) => {
    setBusy(server.name)
    setError(null)
    api
      .setMcpServer(sessionId, server.name, enabled)
      .then(setServers)
      .catch((e) => setError(e instanceof ApiError ? e.message : `Could not change ${server.name}.`))
      .finally(() => setBusy(null))
  }

  const login = (server: McpServer) => {
    setBusy(server.name)
    setError(null)
    api
      .loginMcpServer(sessionId, server.name)
      .then(setServers)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : `Could not sign in to ${server.name}.`)
        // The sign-in may have worked even if the session cannot reach it yet: show where it stands now.
        api.mcpServers(sessionId).then(setServers, () => undefined)
      })
      .finally(() => setBusy(null))
  }

  // Enabled ones first; a stable sort keeps the backend's own order inside each group.
  const sorted = servers ? [...servers].sort((a, b) => Number(mcpOff(a)) - Number(mcpOff(b))) : null
  const onCount = servers?.filter((s) => s.session ?? s.global).length

  return (
    <Popover open={open} onOpenChange={(next) => (next ? !open && onToggleOpen() : onClose())}>
      <PopoverTrigger render={<Button variant="outline" size="sm" title="MCP servers for this session" />}>{onCount == null ? 'Show' : `${onCount} on`}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <PopoverHeader className="flex-row items-center justify-between gap-2">
          <PopoverTitle className="text-small">MCP servers</PopoverTitle>
          <Button variant="ghost" size="icon-xs" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
          </Button>
        </PopoverHeader>
        {loading && !sorted && (
          <p className="flex items-center gap-2 text-small text-muted-foreground">
            <Spinner aria-hidden /> Waking the session…
          </p>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        {sorted && sorted.length === 0 && <p className="text-small text-muted-foreground">No MCP servers.</p>}
        {sorted && sorted.length > 0 && (
          <ul className="flex max-h-80 flex-col divide-y overflow-y-auto">
            {sorted.map((server) => (
              <McpRow
                key={server.name}
                server={server}
                busy={busy === server.name}
                onToggle={() => toggle(server, !(server.session ?? server.global))}
                onReset={() => toggle(server, null)}
                onLogin={() => login(server)}
              />
            ))}
          </ul>
        )}
        <PopoverDescription className="text-meta">For this session only. The setting for all of Sangha is on the home page (MCP).</PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
