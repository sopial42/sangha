import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@sangha/shared'
import { recentWindow } from '../src/session'

const u = (text: string): SessionEvent => ({ t: 'user.message', text })
const a = (text: string): SessionEvent => ({ t: 'assistant.text', text })

describe('recentWindow', () => {
  it('reaches back past a short "continue" to the words before it', () => {
    const events = [u('old'), a('x'), u('merge when it is green'), a('CI restarted, waiting'), u('autonomy'), a('ok'), u('continue'), a('still waiting on CI')]
    expect(recentWindow(events).map((e) => (e.t === 'user.message' || e.t === 'assistant.text' ? e.text : ''))).toEqual([
      'merge when it is green',
      'CI restarted, waiting',
      'autonomy',
      'ok',
      'continue',
      'still waiting on CI',
    ])
  })

  it('keeps everything when there are few messages', () => {
    const events = [u('do X'), a('done')]
    expect(recentWindow(events)).toEqual(events)
  })
})
