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
  it('renders player_disqualified', () => {
    const r = renderTemplate({
      type: 'player_disqualified',
      tournament: 'Season 2 Cup',
      reason: 'Repeated no-shows across group stage matches.',
    })
    expect(r.templateName).toBe('player_disqualified')
    expect(r.body).toContain('Season 2 Cup')
    expect(r.body).toContain('Repeated no-shows')
  })
  it('renders noshow_needs_decision', () => {
    const r = renderTemplate({
      type: 'noshow_needs_decision',
      tournament: 'Lagos Cup',
      round: 'group',
      playerA: 'Ade',
      playerB: 'Bola',
    })
    expect(r.templateName).toBe('noshow_needs_decision')
    expect(r.body).toContain('Lagos Cup')
    expect(r.body).toContain('Ade')
    expect(r.body).toContain('Bola')
  })

  it('appends tap-to-chat links to noshow_needs_decision when numbers are known', () => {
    const r = renderTemplate({
      type: 'noshow_needs_decision',
      tournament: 'Lagos Cup',
      round: 'group',
      playerA: 'Ade',
      playerB: 'Bola',
      playerAWhatsAppUrl: 'https://wa.me/2348012345678',
      playerBWhatsAppUrl: 'https://wa.me/2348087654321',
    })
    expect(r.body).toContain('Message them:')
    expect(r.body).toContain('Ade: https://wa.me/2348012345678')
    expect(r.body).toContain('Bola: https://wa.me/2348087654321')
  })

  it('lists only the reachable player, and omits the block when neither is', () => {
    const one = renderTemplate({
      type: 'noshow_needs_decision',
      tournament: 'Lagos Cup',
      round: 'group',
      playerA: 'Ade',
      playerB: 'Bola',
      playerAWhatsAppUrl: 'https://wa.me/2348012345678',
      playerBWhatsAppUrl: null,
    })
    expect(one.body).toContain('Ade: https://wa.me/2348012345678')
    expect(one.body).not.toContain('Bola: ')

    const none = renderTemplate({
      type: 'noshow_needs_decision',
      tournament: 'Lagos Cup',
      round: 'group',
      playerA: 'Ade',
      playerB: 'Bola',
    })
    expect(none.body).not.toContain('Message them:')
  })
})
