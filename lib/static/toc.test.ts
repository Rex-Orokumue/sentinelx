import { describe, it, expect } from 'vitest'
import { slugifySection, buildToc } from './toc'

describe('slugifySection', () => {
  it('drops a leading section number', () => {
    expect(slugifySection('1. Who We Are')).toBe('who-we-are')
    expect(slugifySection('14. Contact')).toBe('contact')
  })
  it('lowercases and hyphenates', () => {
    expect(slugifySection('Match Rules and Fair Play')).toBe('match-rules-and-fair-play')
  })
  it('strips diacritics from translated headings', () => {
    expect(slugifySection('4. Tournois et frais d’inscription')).toBe('tournois-et-frais-dinscription')
  })
  it('collapses punctuation runs and trims', () => {
    expect(slugifySection('Prizes & Withdrawals!')).toBe('prizes-withdrawals')
  })
})

describe('buildToc', () => {
  it('preserves order and pairs id/title, dropping body', () => {
    const sections = [
      { id: 'a', title: 'Alpha', body: null },
      { id: 'b', title: 'Beta', body: null },
    ]
    expect(buildToc(sections)).toEqual([
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ])
  })
})
