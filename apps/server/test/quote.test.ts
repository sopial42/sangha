import { describe, expect, it } from 'vitest'
import { QUOTE_MAX, splitQuote, withQuote } from '@sangha/shared'

describe('quote', () => {
  it('puts the quote ahead of your words, as a blockquote he reads, and gets both back', () => {
    const text = withQuote({ author: 'Robia', text: 'Line one\n\nLine three' }, 'And why?\n> not a quote')
    expect(text).toBe('> ↩ Replying to Robia:\n> Line one\n> \n> Line three\n\nAnd why?\n> not a quote')
    expect(splitQuote(text)).toEqual({ quote: { author: 'Robia', text: 'Line one\n\nLine three' }, body: 'And why?\n> not a quote' })
  })

  it('leaves a plain message, even one starting with a blockquote, alone', () => {
    expect(splitQuote('> a quote of mine\nmore')).toEqual({ quote: null, body: '> a quote of mine\nmore' })
  })

  it('cuts a long quote', () => {
    const { quote } = splitQuote(withQuote({ author: 'you', text: 'x'.repeat(QUOTE_MAX + 50) }, 'ok'))
    expect(quote!.text).toHaveLength(QUOTE_MAX + 1)
    expect(quote!.text.endsWith('…')).toBe(true)
  })
})
