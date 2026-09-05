import { describe, it, expect } from 'vitest'
import { resolveSpecLine } from './subtitle'

const base = {
  subtitle: null,
  description: null,
  gameName: null,
  category: 'account' as const,
}

describe('resolveSpecLine', () => {
  it('prefers the seller-written subtitle', () => {
    expect(resolveSpecLine({ ...base, subtitle: 'Max Team | 5★ Players' }))
      .toBe('Max Team | 5★ Players')
  })

  it('falls back to the first line of the description', () => {
    expect(resolveSpecLine({ ...base, description: 'Lv. 70 | Rare Skins\nDM to buy' }))
      .toBe('Lv. 70 | Rare Skins')
  })

  it('truncates a long description line with an ellipsis', () => {
    const line = resolveSpecLine({ ...base, description: 'x'.repeat(200) })
    expect(line.length).toBeLessThanOrEqual(60)
    expect(line.endsWith('…')).toBe(true)
  })

  it('falls back to game and category when there is no text', () => {
    expect(resolveSpecLine({ ...base, gameName: 'Dream League Soccer' }))
      .toBe('Dream League Soccer · Account')
  })

  it('falls back to the category alone when there is no game', () => {
    expect(resolveSpecLine(base)).toBe('Account')
  })

  it('treats whitespace-only text as absent rather than rendering a blank row', () => {
    expect(resolveSpecLine({ ...base, subtitle: '   ', description: '\n \n' })).toBe('Account')
  })

  it('never returns an empty string for any category', () => {
    expect(resolveSpecLine({ ...base, category: 'gift_card' })).toBe('Gift Card')
  })
})
