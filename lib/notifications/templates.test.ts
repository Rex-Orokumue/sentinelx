import { describe, it, expect } from 'vitest'
import { renderTemplate } from './templates'

describe('renderTemplate', () => {
  it('registration_confirmed includes the tournament', () => {
    const r = renderTemplate({ type: 'registration_confirmed', tournament: 'DLS Cup' })
    expect(r.templateName).toBe('registration_confirmed')
    expect(r.body).toContain('DLS Cup')
  })
  it('fixture_reminder includes both players and the URL', () => {
    const r = renderTemplate({ type: 'fixture_reminder', playerA: 'Rex', playerB: 'Sam', tournament: 'DLS Cup', matchUrl: 'https://x/m/1' })
    expect(r.body).toContain('Rex')
    expect(r.body).toContain('Sam')
    expect(r.body).toContain('https://x/m/1')
  })
  it('result_confirmed includes the scoreline', () => {
    const r = renderTemplate({ type: 'result_confirmed', playerA: 'Rex', playerB: 'Sam', scoreA: 3, scoreB: 1, tournament: 'DLS Cup' })
    expect(r.body).toContain('3')
    expect(r.body).toContain('1')
  })
  it('prize_credited includes the amount', () => {
    const r = renderTemplate({ type: 'prize_credited', amount: '₦10,000' })
    expect(r.body).toContain('₦10,000')
  })
})
