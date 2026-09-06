import { describe, it, expect } from 'vitest'
import { DELETED_PLAYER_NAME, isDeleted, displayNameFor, profileHrefFor } from './display'

const live = { username: 'sniperking', display_name: 'Sniper King', deleted_at: null }
const tombstone = {
  username: 'deleted_a1b2c3d4',
  display_name: 'Deleted player',
  deleted_at: '2026-09-21T10:00:00Z',
}

describe('isDeleted', () => {
  it('is false for a live profile', () => {
    expect(isDeleted(live)).toBe(false)
  })
  it('is true for a tombstone', () => {
    expect(isDeleted(tombstone)).toBe(true)
  })
  it('is false for a null profile', () => {
    expect(isDeleted(null)).toBe(false)
  })
})

describe('displayNameFor', () => {
  it('prefers display_name for a live profile', () => {
    expect(displayNameFor(live)).toBe('Sniper King')
  })

  it('falls back to username when display_name is missing', () => {
    expect(displayNameFor({ ...live, display_name: null })).toBe('sniperking')
  })

  it('falls back to Player when both are missing', () => {
    expect(displayNameFor({ username: null, display_name: null, deleted_at: null })).toBe('Player')
  })

  it('returns the tombstone name for a deleted profile', () => {
    expect(displayNameFor(tombstone)).toBe(DELETED_PLAYER_NAME)
  })

  // The deleted check runs before any identity field is read, so a row whose
  // anonymisation left stale values behind still cannot leak them.
  it('returns the tombstone name even if stale identity survives', () => {
    expect(displayNameFor({ ...live, deleted_at: '2026-09-21T10:00:00Z' })).toBe(
      DELETED_PLAYER_NAME,
    )
  })

  it('handles a null profile', () => {
    expect(displayNameFor(null)).toBe('Player')
  })
})

describe('profileHrefFor', () => {
  it('links a live profile by username', () => {
    expect(profileHrefFor(live)).toBe('/players/sniperking')
  })

  // The handle is retired and /players/[username] 404s, so there must be no
  // link to follow.
  it('returns null for a deleted profile', () => {
    expect(profileHrefFor(tombstone)).toBeNull()
  })

  it('returns null when there is no username', () => {
    expect(profileHrefFor({ username: null, display_name: 'X', deleted_at: null })).toBeNull()
  })

  it('returns null for a null profile', () => {
    expect(profileHrefFor(null)).toBeNull()
  })
})
