import { describe, it, expect } from 'vitest'
import { splitRules } from './split-rules'

describe('splitRules', () => {
  it('returns [] for empty / nullish input', () => {
    expect(splitRules(null)).toEqual([])
    expect(splitRules(undefined)).toEqual([])
    expect(splitRules('')).toEqual([])
    expect(splitRules('   \n  ')).toEqual([])
  })

  it('splits a dash bullet list into one rule per item', () => {
    const md = '- No cheating\n- Submit a screen recording\n- Be on time'
    expect(splitRules(md)).toEqual(['No cheating', 'Submit a screen recording', 'Be on time'])
  })

  it('splits a numbered list and ignores a heading line', () => {
    const md = '## Rules\n1. First rule\n2. Second rule\n3) Third rule'
    expect(splitRules(md)).toEqual(['First rule', 'Second rule', 'Third rule'])
  })

  it('keeps inline markdown inside each rule', () => {
    expect(splitRules('- Use your **real** IGN\n- No [smurfing](https://x)')).toEqual([
      'Use your **real** IGN',
      'No [smurfing](https://x)',
    ])
  })

  it('falls back to blank-line paragraphs when there is no list', () => {
    const md = 'Matches are best of one.\n\nReport your score within 10 minutes.\n\nAdmin decisions are final.'
    expect(splitRules(md)).toEqual([
      'Matches are best of one.',
      'Report your score within 10 minutes.',
      'Admin decisions are final.',
    ])
  })

  it('returns a single rule when the text is one block', () => {
    expect(splitRules('Just play fair and have fun.')).toEqual(['Just play fair and have fun.'])
  })

  it('does not treat a single bullet as a list', () => {
    expect(splitRules('- The only rule')).toEqual(['The only rule'])
  })
})
