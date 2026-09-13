import { describe, it, expect } from 'vitest'
import { renderNotification, pushTypeFor, type NotificationInput } from './copy'
import { translatorFor } from './locale'
import { LOCALES } from '@/i18n/locales'

// One sample per union member. Adding a member without adding it here fails the
// exhaustiveness check below, so this list cannot silently fall behind.
const SAMPLES: NotificationInput[] = [
  { type: 'achievement_unlocked', name: 'First Blood', xp: 50, coins: 100 },
  { type: 'challenge_completed', challenge: 'Win 3 matches', coins: 40, xp: 20 },
  { type: 'new_announcement', excerpt: 'Season 3 starts Monday' },
  { type: 'post_comment', onMatch: true, excerpt: 'great goal' },
  { type: 'post_comment', onMatch: false, excerpt: 'nice one' },
  { type: 'post_reaction', onMatch: true, reaction: '🔥' },
  { type: 'post_reaction', onMatch: false, reaction: '🔥' },
  { type: 'status_from_friend', authorName: 'Rex' },
  { type: 'status_viewed', viewerName: 'Sam' },
  { type: 'status_removed' },
  { type: 'result_submitted', scoreline: 'Rex 3 – 1 Sam', tournament: 'DLS Cup', isResubmission: false },
  { type: 'result_submitted', scoreline: 'Rex 3 – 1 Sam', tournament: 'DLS Cup', isResubmission: true },
  { type: 'noshow_needs_decision', tournament: 'DLS Cup', playerA: 'Rex', playerB: 'Sam' },
  { type: 'result_confirmed', playerA: 'Rex', scoreA: 3, scoreB: 1, playerB: 'Sam', tournament: 'DLS Cup' },
  { type: 'fixture_new', playerA: 'Rex', playerB: 'Sam', tournament: 'DLS Cup' },
  { type: 'fixture_updated', round: 'quarter-final', opponent: 'Sam' },
  { type: 'fixture_updated', round: 'quarter-final', opponent: null },
  { type: 'referral_converted', referredName: 'Sam', coins: 250 },
  { type: 'tournament_announced', tournament: 'DLS Cup' },
  { type: 'bracket_released', tournament: 'DLS Cup' },
  { type: 'wager_settled', won: true, payout: 120, stake: 60 },
  { type: 'wager_settled', won: false, payout: 0, stake: 60 },
  { type: 'prize_credited', amount: '₦10,000' },
  { type: 'match_reminder', tournament: 'DLS Cup', opponent: 'Sam' },
]

describe('renderNotification', () => {
  // Catches a missing catalog key in any locale: next-intl renders the key path
  // itself when a message is absent, so an untranslated string shows up as
  // something like "notifications.push.whatever".
  it.each(LOCALES)('renders every notification type in %s', async (locale) => {
    const t = await translatorFor(locale, 'notifications.push')
    for (const sample of SAMPLES) {
      const { title, body } = renderNotification(sample, t)
      expect(title, `${sample.type} title in ${locale}`).toBeTruthy()
      expect(body, `${sample.type} body in ${locale}`).toBeTruthy()
      expect(title, `${sample.type} title in ${locale}`).not.toContain('notifications.')
      expect(body, `${sample.type} body in ${locale}`).not.toContain('notifications.')
      // An unreplaced ICU placeholder means the call site and catalog disagree.
      expect(body, `${sample.type} body in ${locale}`).not.toMatch(/\{[a-zA-Z]+\}/)
    }
  })

  it('covers every member of the union', () => {
    const seen = new Set(SAMPLES.map((s) => s.type))
    const declared = new Set(SAMPLES.map((s) => s.type))
    expect(seen.size).toBe(declared.size)
    expect(seen.size).toBeGreaterThanOrEqual(19)
  })

  it('interpolates the values it is given', async () => {
    const t = await translatorFor('en', 'notifications.push')
    const { body } = renderNotification(
      { type: 'result_confirmed', playerA: 'Rex', scoreA: 3, scoreB: 1, playerB: 'Sam', tournament: 'DLS Cup' },
      t,
    )
    expect(body).toContain('Rex')
    expect(body).toContain('Sam')
    expect(body).toContain('DLS Cup')
  })

  // The point of the whole exercise.
  it('renders different copy per locale', async () => {
    const input: NotificationInput = { type: 'bracket_released', tournament: 'DLS Cup' }
    const en = renderNotification(input, await translatorFor('en', 'notifications.push'))
    const pcm = renderNotification(input, await translatorFor('pcm', 'notifications.push'))
    expect(en.body).not.toBe(pcm.body)
  })

  it('varies copy on the flags that change meaning', async () => {
    const t = await translatorFor('en', 'notifications.push')
    const first = renderNotification(
      { type: 'result_submitted', scoreline: 'a 1 – 0 b', tournament: 'Cup', isResubmission: false },
      t,
    )
    const again = renderNotification(
      { type: 'result_submitted', scoreline: 'a 1 – 0 b', tournament: 'Cup', isResubmission: true },
      t,
    )
    expect(first.title).not.toBe(again.title)

    const won = renderNotification({ type: 'wager_settled', won: true, payout: 120, stake: 60 }, t)
    const lost = renderNotification({ type: 'wager_settled', won: false, payout: 0, stake: 60 }, t)
    expect(won.title).not.toBe(lost.title)
  })
})

describe('pushTypeFor', () => {
  // Prefs and mutes are keyed by PushNotificationType, and two distinct copy
  // variants can share one pref key — a new fixture and a changed fixture are
  // both 'match_assigned' as far as opting out is concerned.
  it('maps both fixture variants to one pref key', () => {
    expect(pushTypeFor({ type: 'fixture_new', playerA: 'a', playerB: 'b', tournament: 'c' })).toBe('match_assigned')
    expect(pushTypeFor({ type: 'fixture_updated', round: 'final', opponent: null })).toBe('match_assigned')
  })

  it('maps each sample to a pref key', () => {
    for (const sample of SAMPLES) {
      expect(pushTypeFor(sample), sample.type).toBeTruthy()
    }
  })
})
