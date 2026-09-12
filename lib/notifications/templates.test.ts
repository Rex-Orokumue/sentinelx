import { describe, it, expect, beforeAll } from 'vitest'
import { renderTemplate, type TemplateInput } from './templates'
import { translatorFor, type Translate } from './locale'

// Deliberately the REAL English catalog rather than a stub: that way these
// tests also prove every key exists and interpolates, which a stub would hide.
let t: Translate
beforeAll(async () => {
  t = await translatorFor('en', 'notifications.whatsapp')
})

const render = (input: TemplateInput) => renderTemplate(input, t)

describe('renderTemplate', () => {
  it('registration_confirmed includes the tournament', () => {
    const r = render({ type: 'registration_confirmed', tournament: 'DLS Cup' })
    expect(r.templateName).toBe('registration_confirmed')
    expect(r.body).toContain('DLS Cup')
  })
  it('fixture_reminder includes both players and the URL', () => {
    const r = render({ type: 'fixture_reminder', playerA: 'Rex', playerB: 'Sam', tournament: 'DLS Cup', matchUrl: 'https://x/m/1' })
    expect(r.body).toContain('Rex')
    expect(r.body).toContain('Sam')
    expect(r.body).toContain('https://x/m/1')
  })
  it('result_confirmed includes the scoreline', () => {
    const r = render({ type: 'result_confirmed', playerA: 'Rex', playerB: 'Sam', scoreA: 3, scoreB: 1, tournament: 'DLS Cup' })
    expect(r.body).toContain('3')
    expect(r.body).toContain('1')
  })
  it('prize_credited includes the amount', () => {
    const r = render({ type: 'prize_credited', amount: '₦10,000' })
    expect(r.body).toContain('₦10,000')
  })
  it('renders player_disqualified', () => {
    const r = render({
      type: 'player_disqualified',
      tournament: 'Season 2 Cup',
      reason: 'Repeated no-shows across group stage matches.',
    })
    expect(r.templateName).toBe('player_disqualified')
    expect(r.body).toContain('Season 2 Cup')
    expect(r.body).toContain('Repeated no-shows')
  })
  it('renders noshow_needs_decision', () => {
    const r = render({
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
    const r = render({
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
    const one = render({
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

    const none = render({
      type: 'noshow_needs_decision',
      tournament: 'Lagos Cup',
      round: 'group',
      playerA: 'Ade',
      playerB: 'Bola',
    })
    expect(none.body).not.toContain('Message them:')
  })
})

// The end-to-end promise of Part 8: the same notification, rendered for two
// recipients, differs by THEIR language — nothing about the sender changes.
describe('renders per recipient locale', () => {
  it('produces different copy for en and pcm', async () => {
    const input: TemplateInput = { type: 'registration_confirmed', tournament: 'DLS Cup' }
    const en = renderTemplate(input, await translatorFor('en', 'notifications.whatsapp'))
    const pcm = renderTemplate(input, await translatorFor('pcm', 'notifications.whatsapp'))

    expect(en.body).not.toBe(pcm.body)
    expect(pcm.body).toContain('You don register')
    // The tournament name is data, not copy — it is identical in both.
    expect(en.body).toContain('DLS Cup')
    expect(pcm.body).toContain('DLS Cup')
  })

  // Termii/Meta register templates by name; a translated name is an
  // unregistered one and the send would fail.
  it('keeps templateName identical across locales', async () => {
    const input: TemplateInput = { type: 'prize_credited', amount: '₦10,000' }
    const en = renderTemplate(input, await translatorFor('en', 'notifications.whatsapp'))
    const fr = renderTemplate(input, await translatorFor('fr', 'notifications.whatsapp'))
    expect(en.templateName).toBe('prize_credited')
    expect(fr.templateName).toBe('prize_credited')
  })
})
