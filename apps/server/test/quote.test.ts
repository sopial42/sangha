import { describe, expect, it } from 'vitest'
import { QUOTE_MAX, splitQuote, withQuote } from '@sangha/shared'

describe('quote', () => {
  it('puts the quote ahead of your words, as a blockquote he reads, and gets both back', () => {
    const text = withQuote({ author: 'Robia', text: 'Ligne un\n\nLigne trois' }, 'Et pourquoi ?\n> pas une citation')
    expect(text).toBe('> ↩ En réponse à Robia :\n> Ligne un\n> \n> Ligne trois\n\nEt pourquoi ?\n> pas une citation')
    expect(splitQuote(text)).toEqual({ quote: { author: 'Robia', text: 'Ligne un\n\nLigne trois' }, body: 'Et pourquoi ?\n> pas une citation' })
  })

  it('leaves a plain message, even one starting with a blockquote, alone', () => {
    expect(splitQuote('> une citation à moi\nsuite')).toEqual({ quote: null, body: '> une citation à moi\nsuite' })
  })

  it('cuts a long quote', () => {
    const { quote } = splitQuote(withQuote({ author: 'toi', text: 'x'.repeat(QUOTE_MAX + 50) }, 'ok'))
    expect(quote!.text).toHaveLength(QUOTE_MAX + 1)
    expect(quote!.text.endsWith('…')).toBe(true)
  })
})
