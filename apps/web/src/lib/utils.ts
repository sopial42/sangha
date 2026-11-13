import { createCn } from 'cn/config'

/**
 * Class merging that knows Sangha's type scale: without this, `text-meta` and friends read as colours
 * and silently drop the real colour class next to them (e.g. `text-muted-foreground`).
 * Components import `cn` from here, never from "cn" directly.
 */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['meta', 'small', 'ui', 'chat', 'title'] }] } },
})
