import { createElement, type ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { CheckListIcon, CommandLineIcon, File01Icon, Globe02Icon, MagicWand01Icon, PencilEdit02Icon, Plug01Icon, Search01Icon, SparklesIcon, Wrench01Icon } from '@hugeicons/core-free-icons'
import type { MonkProfile } from '@sangha/shared'

const WANDERER_ROBES = ['#7d8a6a', '#6a7d8a', '#8a6a7d', '#9a8a5a', '#5a7a7a']

/** Profile for a known subagent, or a generated one (stable colour from its name) for built-in / plugin subagents. */
export function profileFor(agentType: string, profiles: MonkProfile[]): MonkProfile {
  const known = profiles.find((p) => p.agentType === agentType)
  if (known) return known
  const hash = [...agentType].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return { agentType, name: agentType, role: 'Subagent', robe: WANDERER_ROBES[hash % WANDERER_ROBES.length]!, model: '' }
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
