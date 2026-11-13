import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { SubagentProfile } from '@sangha/shared'

// The subagents a team lead session summons. Other sessions may summon
// built-in or plugin agents, which show up as unlisted subagents.
const SUBAGENT_MODEL = process.env.SANGHA_SUBAGENT_MODEL ?? process.env.SANGHA_NOVICE_MODEL ?? 'sonnet'

type Subagent = SubagentProfile & { def: AgentDefinition }

const subagent = (p: Omit<SubagentProfile, 'model'>, def: Omit<AgentDefinition, 'model'>): Subagent => ({
  ...p,
  model: SUBAGENT_MODEL,
  def: { ...def, model: SUBAGENT_MODEL },
})

export const SUBAGENTS: Subagent[] = [
  subagent(
    { agentType: 'architect', name: 'Architect', role: 'Architect', color: '#9c9b97' },
    {
      description: 'Designs solutions and writes implementation plans. Read-only.',
      prompt: 'You are the architect subagent. Explore the code, then produce a concise, concrete plan: files, steps, risks. Never edit files.',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
    },
  ),
  subagent(
    { agentType: 'back', name: 'Backend', role: 'Backend', color: '#9c9b97' },
    {
      description: 'Implements backend code, APIs, data and infrastructure.',
      prompt: 'You are the backend subagent. Implement the requested change cleanly, with tests. Report what changed.',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      skills: ['superpowers:test-driven-development'],
    },
  ),
  subagent(
    { agentType: 'front', name: 'Frontend', role: 'Frontend / UI', color: '#9c9b97' },
    {
      description: 'Implements user interfaces with strong UX and visual design.',
      prompt: 'You are the UI subagent. Build accessible, polished interfaces. Use the ui-ux-pro-max and frontend-design skills.',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      skills: ['ui-ux-pro-max:ui-ux-pro-max', 'frontend-design:frontend-design'],
    },
  ),
  subagent(
    { agentType: 'reviewer', name: 'Reviewer', role: 'Reviewer', color: '#9c9b97' },
    {
      description: 'Reviews changes for bugs and runs the tests. Does not edit code.',
      prompt: 'You are the reviewer subagent. Review the diff for correctness, run the tests, and report findings ranked by severity. Never edit files.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
  ),
]

export const agentDefinitions = (): Record<string, AgentDefinition> => Object.fromEntries(SUBAGENTS.map((m) => [m.agentType, m.def]))

export const profiles = (): SubagentProfile[] => SUBAGENTS.map(({ def: _def, ...p }) => p)
