import { describe, it, expect } from 'vitest'
import { isBoostLive, BOOST_DURATION_MS } from './boost'

const now = new Date('2026-09-07T12:00:00Z')
const offset = (ms: number) => new Date(now.getTime() + ms).toISOString()

describe('isBoostLive', () => {
  it('is false for a post that was never boosted', () => {
    expect(isBoostLive(null, now)).toBe(false)
  })

  it('is true while the boost is still running', () => {
    expect(isBoostLive(offset(60 * 60 * 1000), now)).toBe(true)
  })

  // THE BUG: the feed ordered by boosted_until with nullsFirst:false, so ANY
  // non-null value outranked every unboosted post — including a boost that
  // expired weeks ago. One post boosted on 17 August was still sitting at the
  // top of the feed three weeks later. The badge correctly disappeared after
  // 24h, so the boost looked over while its ranking never expired.
  it('is false once the boost has expired', () => {
    expect(isBoostLive(offset(-1000), now)).toBe(false)
  })

  it('is false for a boost that expired weeks ago', () => {
    expect(isBoostLive('2026-08-17T10:52:31Z', now)).toBe(false)
  })

  // Exactly at the deadline the boost is over — a boost bought at noon ends at
  // noon the next day, it does not get an extra instant.
  it('is false exactly at the expiry instant', () => {
    expect(isBoostLive(now.toISOString(), now)).toBe(false)
  })

  it('handles an unparseable timestamp as not boosted', () => {
    expect(isBoostLive('not-a-date', now)).toBe(false)
  })
})

describe('BOOST_DURATION_MS', () => {
  it('is 24 hours', () => {
    expect(BOOST_DURATION_MS).toBe(24 * 60 * 60 * 1000)
  })
})
