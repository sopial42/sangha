import { describe, expect, it } from 'vitest'
import type { MonasteryEvent } from '@sangha/shared'
import { recentWindow } from '../src/session'

const u = (text: string): MonasteryEvent => ({ t: 'user.message', text })
const a = (text: string): MonasteryEvent => ({ t: 'buddha.text', text })

describe('recentWindow', () => {
  it('reaches back past a short "reprend" to the words before it', () => {
    const events = [u('old'), a('x'), u('merge quand c’est green'), a('CI relancée, j’attends'), u('autonomie'), a('ok'), u('reprend'), a('toujours en attente de la CI')]
    expect(recentWindow(events).map((e) => (e.t === 'user.message' || e.t === 'buddha.text' ? e.text : ''))).toEqual([
      'merge quand c’est green',
      'CI relancée, j’attends',
      'autonomie',
      'ok',
      'reprend',
      'toujours en attente de la CI',
    ])
  })

  it('keeps everything when there are few messages', () => {
    const events = [u('fais X'), a('fait')]
    expect(recentWindow(events)).toEqual(events)
  })
})
