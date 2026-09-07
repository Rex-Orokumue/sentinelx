import { describe, it, expect } from 'vitest'
import { isMuted, muteExpiryFor, ALWAYS_MUTED_UNTIL, type MuteRow } from './mutes'

const now = new Date('2026-09-07T12:00:00Z')
const at = (ms: number) => new Date(now.getTime() + ms).toISOString()
const HOUR = 60 * 60 * 1000

const typeMute = (type: string, untilMs: number): MuteRow => ({
  notification_type: type,
  post_id: null,
  muted_until: at(untilMs),
})
const postMute = (postId: string, untilMs: number): MuteRow => ({
  notification_type: null,
  post_id: postId,
  muted_until: at(untilMs),
})

describe('isMuted — nothing muted', () => {
  it('allows a push when there are no mutes', () => {
    expect(isMuted([], { type: 'post_reaction', postId: 'p1' }, now)).toBe(false)
  })
})

describe('isMuted — type scope', () => {
  it('blocks a muted type', () => {
    expect(isMuted([typeMute('post_reaction', HOUR)], { type: 'post_reaction' }, now)).toBe(true)
  })

  it('allows a different type', () => {
    expect(isMuted([typeMute('post_reaction', HOUR)], { type: 'match_assigned' }, now)).toBe(false)
  })

  // The whole point of a timed mute: it lapses on its own, without the player
  // having to remember to turn anything back on.
  it('allows once the mute has expired', () => {
    expect(isMuted([typeMute('post_reaction', -1000)], { type: 'post_reaction' }, now)).toBe(false)
  })

  it('is expired exactly at the deadline', () => {
    expect(isMuted([typeMute('post_reaction', 0)], { type: 'post_reaction' }, now)).toBe(false)
  })
})

describe('isMuted — post scope', () => {
  it('blocks any notification about a muted post', () => {
    expect(isMuted([postMute('p1', HOUR)], { type: 'post_comment', postId: 'p1' }, now)).toBe(true)
  })

  // Muting one busy thread must not silence the rest of the feed.
  it('allows a different post', () => {
    expect(isMuted([postMute('p1', HOUR)], { type: 'post_comment', postId: 'p2' }, now)).toBe(false)
  })

  it('allows a notification with no post at all', () => {
    expect(isMuted([postMute('p1', HOUR)], { type: 'match_assigned' }, now)).toBe(false)
  })

  it('allows once the post mute has expired', () => {
    expect(isMuted([postMute('p1', -1000)], { type: 'post_comment', postId: 'p1' }, now)).toBe(false)
  })
})

describe('isMuted — either scope silences', () => {
  it('blocks when the type is muted even if the post is not', () => {
    expect(
      isMuted([typeMute('post_comment', HOUR)], { type: 'post_comment', postId: 'p9' }, now),
    ).toBe(true)
  })

  it('blocks when the post is muted even if the type is not', () => {
    expect(isMuted([postMute('p9', HOUR)], { type: 'post_comment', postId: 'p9' }, now)).toBe(true)
  })

  it('allows when both mutes have lapsed', () => {
    expect(
      isMuted(
        [typeMute('post_comment', -1), postMute('p9', -1)],
        { type: 'post_comment', postId: 'p9' },
        now,
      ),
    ).toBe(false)
  })
})

describe('muteExpiryFor', () => {
  it('is an hour out for 1h', () => {
    expect(muteExpiryFor('1h', now).toISOString()).toBe('2026-09-07T13:00:00.000Z')
  })

  it('is a week out for 1w', () => {
    expect(muteExpiryFor('1w', now).toISOString()).toBe('2026-09-14T12:00:00.000Z')
  })

  // "Always" is a far-future timestamp rather than a separate nullable column,
  // so every mute goes through one comparison.
  it('is far future for always', () => {
    expect(muteExpiryFor('always', now).toISOString()).toBe(ALWAYS_MUTED_UNTIL)
    expect(new Date(ALWAYS_MUTED_UNTIL).getTime()).toBeGreaterThan(now.getTime())
  })

  it('treats an always mute as live', () => {
    expect(
      isMuted(
        [{ notification_type: 'post_reaction', post_id: null, muted_until: ALWAYS_MUTED_UNTIL }],
        { type: 'post_reaction' },
        now,
      ),
    ).toBe(true)
  })
})
