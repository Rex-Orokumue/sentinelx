import { describe, it, expect } from 'vitest'
import { toMeResponse } from './me'

const ctx = { userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false } as never

describe('toMeResponse', () => {
  it('maps the profile row to camelCase and carries the role flags the app needs to show Admin', () => {
    const res = toMeResponse(ctx, {
      username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: '0803', country: 'NG',
      locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
    })
    expect(res).toEqual({
      id: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false,
      profile: {
        username: 'ada', displayName: 'Ada', avatarUrl: null, whatsappNumber: '0803', country: 'NG',
        locale: 'en', membershipTier: 'guardian', kycVerified: false, deletionRequestedAt: null,
      },
    })
  })
  it('returns a null profile when the row does not exist yet', () => {
    expect(toMeResponse(ctx, null).profile).toBeNull()
  })
})
