import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { MonkProfile } from '@sangha/shared'

// Novices: the subagents a team lead priest summons. Other priests may summon
// built-in or plugin agents, who show up as wandering novices.
const MONK_MODEL = process.env.SANGHA_NOVICE_MODEL ?? 'sonnet'

type Monk = MonkProfile & { def: AgentDefinition }

const monk = (p: Omit<MonkProfile, 'model'>, def: Omit<AgentDefinition, 'model'>): Monk => ({
  ...p,
  model: MONK_MODEL,
  def: { ...def, model: MONK_MODEL },
})

export const MONKS: Monk[] = [
  monk(
    { agentType: 'architect', name: 'Ānanda', role: 'Architecte', robe: '#c2703d' },
    {
      description: 'Designs solutions and writes implementation plans. Read-only.',
      prompt: 'You are Ānanda, the architect monk. Explore the code, then produce a concise, concrete plan: files, steps, risks. Never edit files.',
      tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
    },
  ),
  monk(
    { agentType: 'back', name: 'Sāriputta', role: 'Moine back', robe: '#8a5a2b' },
    {
      description: 'Implements backend code, APIs, data and infrastructure.',
      prompt: 'You are Sāriputta, the backend monk. Implement the requested change cleanly, with tests. Report what changed.',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      skills: ['superpowers:test-driven-development'],
    },
  ),
  monk(
    { agentType: 'front', name: 'Uppalavaṇṇā', role: 'Moine front / UI', robe: '#b8860b' },
    {
      description: 'Implements user interfaces with strong UX and visual design.',
      prompt: 'You are Uppalavaṇṇā, the UI monk. Build accessible, polished interfaces. Use the ui-ux-pro-max and frontend-design skills.',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      skills: ['ui-ux-pro-max:ui-ux-pro-max', 'frontend-design:frontend-design'],
    },
  ),
  monk(
    { agentType: 'reviewer', name: 'Mahākassapa', role: 'Reviewer', robe: '#6b4e3d' },
    {
      description: 'Reviews changes for bugs and runs the tests. Does not edit code.',
      prompt: 'You are Mahākassapa, the reviewer monk. Review the diff for correctness, run the tests, and report findings ranked by severity. Never edit files.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
  ),
]

export const agentDefinitions = (): Record<string, AgentDefinition> => Object.fromEntries(MONKS.map((m) => [m.agentType, m.def]))

export const profiles = (): MonkProfile[] => MONKS.map(({ def: _def, ...p }) => p)
