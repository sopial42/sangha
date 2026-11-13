// Demo data for the README screenshots: fictional projects and sessions, nothing personal.
export function fixtures(F) {
  const now = Date.now()
  const min = 60_000
  const agents = [
    { id: 'lead', title: 'Team lead', description: 'Does the work itself and hands its subagents broad searches and long reads.', source: 'sangha', model: 'opus' },
    { id: 'reviewer', title: 'Reviewer', description: 'Reviews a change against the codebase conventions.', source: 'project', model: null },
  ]
  const projects = ['atlas-web', 'billing-api', 'mobile-app', 'infra', 'design-system', 'docs'].map((name) => ({
    name,
    path: `/home/dev/code/${name}`,
    local: true,
    ...(F.projectColor ? { color: '#888888' } : {}),
    isGit: true,
    branch: 'main',
    agents,
  }))
  let n = 0
  const s = (project, title, status, extra = {}) => ({
    id: `demo-${++n}`,
    project,
    agent: 'lead',
    title,
    createdAt: now - (extra.age ?? 40) * min,
    claudeSessionId: null,
    branch: `sangha/${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`,
    status,
    activity: null,
    doing: null,
    [F.subagents]: [],
    recap: null,
    external: false,
    alive: false,
    silenced: false,
    [F.setAside]: false,
    note: null,
    reminder: null,
    autonomy: null,
    env: {},
    queued: [],
    context: 120_000,
    cost: 1.2,
    renewal: null,
    [F.handoff]: null,
    cwd: `/home/dev/code/.worktrees/${project}/${n}`,
    pr: null,
    scripts: [],
    parent: null,
    ...extra,
  })
  const sub = (k, agentType, description) => ({ [F.subagentId]: `sub-${k}`, agentType, description, lastTool: { tool: 'Read', summary: 'src/app.ts' } })
  const sessions = [
    s('atlas-web', 'Drop the legacy sessions table', 'waiting', {
      age: 52,
      context: 412_000,
      cost: 1.84,
      branch: 'feat/auth',
      recap: { done: 'Sessions now live in signed cookies, all 48 session tests pass.', next: 'Needs your OK to drop the old sessions table.', state: 'question' },
    }),
    s('atlas-web', 'Checkout redesign', 'working', { age: 34, doing: 'Rebuilding the payment step as a single form', [F.subagents]: [sub(1, 'Explore', 'Find every price formatter'), sub(2, 'Test runner', 'Run the checkout tests')] }),
    s('atlas-web', 'Review checkout flow', 'working', { agent: 'reviewer', age: 12, doing: 'Reading the diff of the payment step' }),
    s('billing-api', 'Webhook retries', 'error', { age: 25, recap: { done: 'The retry queue crashed on a malformed payload.', next: 'Look at the stack trace in the last message.', state: 'done' } }),
    s('billing-api', 'Rate limiter', 'idle', { age: 300, context: 470_000, cost: 6.4 }),
    s('billing-api', 'Invoice PDF export', 'working', { age: 18, doing: 'Laying out the invoice table' }),
    s('mobile-app', 'Offline sync', 'working', { age: 61, doing: 'Writing the sync queue', [F.subagents]: [sub(3, 'Explore', 'Storage layer'), sub(4, 'Explore', 'Network layer'), sub(5, 'Test runner', 'Sync tests')] }),
    s('mobile-app', 'Push notification copy', 'waiting', { age: 15, recap: { done: 'Drafted three versions of the reminder copy.', next: 'Pick the one you prefer.', state: 'question' } }),
    s('infra', 'Terraform plan for staging', 'working', { age: 9, doing: 'Planning the new load balancer' }),
    s('infra', 'Migrate CI runners', 'interrupted', { age: 80 }),
    s('design-system', 'Button accessibility audit', 'working', { agent: 'reviewer', age: 22, doing: 'Checking focus rings and contrast' }),
    s('design-system', 'Token cleanup', 'idle', { age: 400, context: 160_000 }),
    s('docs', 'API reference rewrite', 'working', { age: 44, doing: 'Writing the webhooks section' }),
  ]
  // A headless session launched by "API reference rewrite".
  sessions.push(s('docs', 'Fix broken links', 'working', { age: 6, parent: sessions.at(-1).id, doing: 'Checking links in /guides' }))
  sessions.push(s('atlas-web', 'Orchestrator', 'idle', { id: F.orchestratorId, project: 'atlas-web', agent: F.orchestratorAgent }))

  const focusId = sessions[0].id
  let seq = 0
  const ev = (minutesAgo, e) => ({ seq: ++seq, at: now - minutesAgo * min, ev: e })
  const T = F.ev
  const chat = [
    ev(52, { t: 'session.started', model: 'opus', agents: [], skills: [], plugins: [], claudeSessionId: 'x' }),
    ev(52, { t: 'user.message', text: 'Move user sessions to signed cookies and get rid of the old sessions table. Keep everyone logged in.' }),
    ev(51, { t: T.text, text: 'I will switch the session store to signed cookies first, keep the table readable during the switch, then propose dropping it once nothing reads it.' }),
    ev(50, { t: T.tool, tool: 'Grep', summary: 'sessions_table in src/' }),
    ev(49, { t: T.tool, tool: 'Read', summary: 'src/auth/session-store.ts' }),
    ev(44, { t: T.tool, tool: 'Edit', summary: 'src/auth/session-store.ts' }),
    ev(43, { t: T.tool, tool: 'Edit', summary: 'src/auth/middleware.ts' }),
    ev(40, { t: T.tool, tool: 'Bash', summary: 'npm test -- session' }),
    ev(39, { t: T.text, text: 'Done. Sessions are now signed cookies, and the **48 session tests pass**.\n\n| | Before | After |\n|---|---|---|\n| Storage | `sessions` table | signed cookie |\n| Reads per request | 1 query | none |\n| Logout everywhere | delete rows | rotate the key |' }),
    ev(30, { t: 'user.message', text: 'What happens to people who are logged in right now?' }),
    ev(29, { t: T.text, text: 'Nobody gets logged out: on their next request the middleware reads the old row once, issues a cookie, and never reads the table again. After a day, nothing will touch it.' }),
    ev(5, { t: T.text, text: 'The table has not been read for 24 hours. Can I drop it? The migration is one line and a backup was taken at 10:20.' }),
    ev(5, { t: 'turn.done', ok: true, costUsdEquiv: 0.42, durationMs: 41000, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
  ]

  const quota = { status: 'allowed', fiveHour: { utilization: 0.41, resetsAt: Math.round((now + 134 * min) / 1000) }, sevenDay: { utilization: 0.62, resetsAt: Math.round((now + 3 * 24 * 60 * min) / 1000) } }
  const reserve = { enabled: true, pct: 10, reached: false, window: null }
  return { projects, sessions, focusId, chat, quota, reserve }
}

export const NAMES = {
  subagents: 'subagents',
  setAside: 'setAside',
  handoff: 'handoff',
  subagentId: 'subagentId',
  orchestratorId: 'orchestrator',
  orchestratorAgent: 'orchestrator',
  projectColor: false,
  ev: { text: 'assistant.text', tool: 'assistant.tool' },
  routes: { profiles: '/api/subagent-profiles' },
}
