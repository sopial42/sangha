import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentOption } from '@sangha/shared'
import { agentDefinitions } from './subagents'

const LEAD_MODEL = process.env.SANGHA_LEAD_MODEL ?? 'opus'

type Role = AgentOption & { options: () => Partial<Options> }

const ROLES: Role[] = [
  {
    id: 'lead',
    title: 'Team lead',
    description: 'Does the work itself and hands its subagents whatever would weigh down its context: broad searches, long reads and parallel tasks.',
    source: 'sangha',
    model: LEAD_MODEL,
    options: () => ({
      model: LEAD_MODEL,
      agents: agentDefinitions(),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: `You are a team lead session run by Sangha, working in your own git worktree.
Do the work yourself. Delegate to your subagents (with the Agent tool) when it is useful, in particular
to protect your own context: send heavy exploration and large reads to a subagent rather than doing them on your
main thread, and keep the main thread light. Delegate in parallel when tasks are independent: architect (plans,
read-only), back (backend), front (UI), reviewer (review, tests).
Superpowers skills are available: brainstorming, writing-plans, test-driven-development, systematic-debugging.
Commit finished work on your branch. Report briefly what you and each subagent achieved.`,
      },
    }),
  },
]

export const SANGHA_ROLES: AgentOption[] = ROLES.map(({ options: _o, ...r }) => r)

/**
 * SDK options for a session. A Sangha role brings its own prompt and tools; a project agent
 * (from the repo's .claude/agents) runs as the main thread, exactly like `claude --agent <id>`.
 */
export function agentOptions(agent: string): Partial<Options> {
  const role = ROLES.find((r) => r.id === agent)
  if (role) return role.options()
  // Plain Claude (e.g. an adopted terminal session that ran without --agent).
  return agent === 'claude' ? {} : { agent }
}
