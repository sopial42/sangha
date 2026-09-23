import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentOption } from '@sangha/shared'
import { agentDefinitions } from './monks'

const LEAD_MODEL = process.env.SANGHA_LEAD_MODEL ?? 'opus'
const WORKER_MODEL = process.env.SANGHA_WORKER_MODEL ?? 'sonnet'

type Role = AgentOption & { options: () => Partial<Options> }

const ROLES: Role[] = [
  {
    id: 'lead',
    title: 'Team lead',
    description: 'Orchestre le travail et délègue à ses novices (architecte, back, front, reviewer).',
    source: 'sangha',
    model: LEAD_MODEL,
    options: () => ({
      model: LEAD_MODEL,
      agents: agentDefinitions(),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: `You are a team lead priest of the Sangha monastery, working in your own git worktree.
Break the request down and delegate real work to your novices (subagents) with the Agent tool, in parallel
when tasks are independent: architect (plans, read-only), back (backend), front (UI), reviewer (review, tests).
Superpowers skills are available: brainstorming, writing-plans, test-driven-development, systematic-debugging.
Commit finished work on your branch. Report briefly what each novice achieved.`,
      },
    }),
  },
  {
    id: 'chat',
    title: 'Conversation',
    description: 'Discute du code avec toi, explore, explique et modifie si tu le lui demandes.',
    source: 'sangha',
    model: WORKER_MODEL,
    options: () => ({
      model: WORKER_MODEL,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'You are a Sangha priest having a conversation about this codebase, in your own git worktree. Explore and explain; change code only when asked.',
      },
    }),
  },
  {
    id: 'review',
    title: 'Review',
    description: 'Relit une branche, un diff ou un ticket, lance les tests et rend une review classée par gravité.',
    source: 'sangha',
    model: WORKER_MODEL,
    options: () => ({
      model: WORKER_MODEL,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append:
          'You are a Sangha reviewer priest. Review what you are asked to (branch, diff, ticket), run the tests, and report findings ranked by severity with file:line. Fix only when asked.',
      },
    }),
  },
]

export const SANGHA_ROLES: AgentOption[] = ROLES.map(({ options: _o, ...r }) => r)

/**
 * SDK options for a priest. A Sangha role brings its own prompt and tools; a project agent
 * (from the repo's .claude/agents) runs as the main thread, exactly like `claude --agent <id>`.
 */
export function priestOptions(agent: string): Partial<Options> {
  const role = ROLES.find((r) => r.id === agent)
  if (role) return role.options()
  // Plain Claude (e.g. an adopted terminal session that ran without --agent).
  return agent === 'claude' ? {} : { agent }
}
