import { describe, it, expect } from 'vitest'
import { toMeResponse } from './me'

const ctx = { userId: 'u1', email: 'a@b.c', roles: [], isStaff: false, isAdmin: false } as never
const row = {
  username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: null, country: null,
  locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
  profile_completed_at: null as string | null, consent_whatsapp_updates: false,
  equipped_bubble_skin: null as string | null,
}

describe('toMeResponse bubble skin (additive)', () => {
  it('resolves the equipped slug to a relative image path', () => {
    const p = toMeResponse(ctx, { ...row, equipped_bubble_skin: 'bubble_neon_mascot' }, []).profile
    expect(p?.equippedBubbleSkin).toBe('bubble_neon_mascot')
    expect(p?.bubbleSkinUrl).toBe('/coin-items/bubble-mascot-neon.webp')
  })
  it('none equipped is null and null', () => {
    const p = toMeResponse(ctx, row, []).profile
    expect(p?.equippedBubbleSkin).toBeNull()
    expect(p?.bubbleSkinUrl).toBeNull()
  })
  it('an equipped slug with no known image keeps the slug and has a null url (unknown values degrade, never crash)', () => {
    const p = toMeResponse(ctx, { ...row, equipped_bubble_skin: 'bubble_future_item' }, []).profile
    expect(p?.equippedBubbleSkin).toBe('bubble_future_item')
    expect(p?.bubbleSkinUrl).toBeNull()
  })
  it('every pre-existing profile key is still present', () => {
    const p = toMeResponse(ctx, row, []).profile as Record<string, unknown>
    for (const k of ['username', 'displayName', 'avatarUrl', 'whatsappNumber', 'country', 'locale', 'membershipTier', 'kycVerified', 'deletionRequestedAt', 'profileCompletedAt', 'consentWhatsappUpdates', 'gameInterests']) {
      expect(k in p, k).toBe(true)
    }
  })
})
