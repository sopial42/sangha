import { createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Projects } from './projects'
import type { Sessions } from './session'

const BUDDHA_MODEL = process.env.SANGHA_BUDDHA_MODEL ?? 'sonnet'

const BUDDHA_PROMPT = `You are Buddha, the abbot of the Sangha monastery. The user can ask you anything.
Your monastery holds the user's git projects. Each piece of work is done by a priest: a separate Claude Code
session running in its own git worktree (branch sangha/...), with its own novices (subagents).

With your sangha tools you list projects and the agents each one offers, start priests, talk to them and read
their reports. When the user asks for work on a project:
- pick the agent that fits. Prefer the project's own agents (source "project", e.g. kiat-team-lead for a
  full feature in a repo that ships it) over the Sangha role (lead);
- write the priest a complete, self-contained instruction: he does not see this conversation;
- start several priests in parallel when the user asks for several things.
Do not do the project work yourself: delegate to priests. You may read files to understand a request.
Reply in the user's language, briefly: which priest you started, on which project and agent, and why.`

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

/** Buddha's session options, with his tools: an in-process MCP server driving the monastery. */
export function buddhaOptions(sessions: Sessions, projects: Projects): Partial<Options> {
  const server = createSdkMcpServer({
    name: 'sangha',
    version: '1.0.0',
    tools: [
      tool('list_projects', 'List the projects of the monastery and the agents each one can run as a priest.', {}, async () =>
        text(
          (await projects.list()).map((p) => ({
            name: p.name,
            branch: p.branch,
            isGit: p.isGit,
            agents: p.agents.map((a) => ({ id: a.id, source: a.source, description: a.description })),
          })),
        ),
      ),
      tool('list_sessions', 'List the priests (sessions) with their status: working, waiting (finished, unread), idle, error, interrupted.', {}, async () =>
        text(
          sessions
            .summaries()
            .filter((s) => s.agent !== 'buddha')
            .map((s) => ({ id: s.id, project: s.project, agent: s.agent, title: s.title, status: s.status, branch: s.branch, novices: s.novices.length })),
        ),
      ),
      tool(
        'start_session',
        'Start a priest on a project with the given agent and instruction. Returns the new session.',
        {
          project: z.string().describe('Project name, from list_projects'),
          agent: z.string().describe('Agent id available for that project, from list_projects'),
          prompt: z.string().describe('Complete, self-contained instruction for the priest'),
          base_ref: z.string().optional().describe('Git branch or commit to start from (default: the project HEAD)'),
        },
        async ({ project, agent, prompt, base_ref }) => {
          const s = await sessions.create({ project, agent, prompt, baseRef: base_ref })
          return text({ id: s.id, project: s.project, agent: s.agent, branch: s.branch, status: s.status })
        },
      ),
      tool(
        'send_to_session',
        'Send a message to a running or finished priest.',
        { session_id: z.string(), message: z.string() },
        async ({ session_id, message }) => {
          return text(await sessions.reply(session_id, message))
        },
      ),
      tool('read_session', 'Read a priest status and his last words.', { session_id: z.string() }, async ({ session_id }) => {
        const s = sessions.summaryOf(session_id)
        if (!s) return text('unknown session')
        return text({ status: s.status, project: s.project, agent: s.agent, branch: s.branch, activity: s.activity, lastWords: sessions.lastWords(session_id) })
      }),
    ],
  })

  return {
    model: BUDDHA_MODEL,
    mcpServers: { sangha: server },
    plugins: [],
    settingSources: [],
    disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Agent', 'Task'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: BUDDHA_PROMPT },
  }
}
