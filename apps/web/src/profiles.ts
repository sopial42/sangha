import type { MonkProfile } from '@sangha/shared'

const WANDERER_ROBES = ['#7d8a6a', '#6a7d8a', '#8a6a7d', '#9a8a5a', '#5a7a7a']

/** Profile for a resident monk, or a "wandering monk" for built-in / plugin subagents. */
export function profileFor(agentType: string, profiles: MonkProfile[]): MonkProfile {
  const known = profiles.find((p) => p.agentType === agentType)
  if (known) return known
  const hash = [...agentType].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return { agentType, name: agentType, role: 'Moine de passage', robe: WANDERER_ROBES[hash % WANDERER_ROBES.length]!, model: '' }
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📜',
  Edit: '🖌️',
  Write: '🖌️',
  NotebookEdit: '🖌️',
  Bash: '🔔',
  Grep: '🔍',
  Glob: '🔍',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Skill: '📿',
  TodoWrite: '🪷',
}

export const toolIcon = (tool: string) => TOOL_ICONS[tool] ?? (tool.startsWith('mcp__sangha__') ? '☸' : tool.startsWith('mcp__') ? '🔌' : '✦')
