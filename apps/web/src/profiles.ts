import { createElement, type ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { CheckListIcon, CommandLineIcon, File01Icon, Globe02Icon, MagicWand01Icon, PencilEdit02Icon, Plug01Icon, Search01Icon, SparklesIcon, Wrench01Icon } from '@hugeicons/core-free-icons'
import type { SubagentProfile } from '@sangha/shared'

/** Profile for a known subagent, or a plain one for built-in / plugin subagents. Colour means attention in Sangha, so subagents stay neutral. */
export function profileFor(agentType: string, profiles: SubagentProfile[]): SubagentProfile {
  return profiles.find((p) => p.agentType === agentType) ?? { agentType, name: agentType, role: 'Subagent', color: '#9c9b97', model: '' }
}

const TOOL_ICONS: Record<string, IconSvgElement> = {
  Read: File01Icon,
  Edit: PencilEdit02Icon,
  Write: PencilEdit02Icon,
  NotebookEdit: PencilEdit02Icon,
  Bash: CommandLineIcon,
  Grep: Search01Icon,
  Glob: Search01Icon,
  WebFetch: Globe02Icon,
  WebSearch: Globe02Icon,
  Skill: MagicWand01Icon,
  TodoWrite: CheckListIcon,
}

/** The Hugeicons icon object for a tool: Sangha's own tools, other MCP tools, then a generic wrench. */
export const toolIconOf = (tool: string): IconSvgElement =>
  TOOL_ICONS[tool] ?? (tool.startsWith('mcp__sangha__') ? SparklesIcon : tool.startsWith('mcp__') ? Plug01Icon : Wrench01Icon)

/** A tool's icon, rendered inline at text size (inherits the current colour). */
export const toolIcon = (tool: string, className = 'inline-block size-3.5 shrink-0 align-[-2px]'): ReactNode =>
  createElement(HugeiconsIcon, { icon: toolIconOf(tool), strokeWidth: 1.8, className, 'aria-hidden': true })
