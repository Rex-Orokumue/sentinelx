import { describe, it, expect } from 'vitest'
import { meResponse, toMeResponse, updateProfileErrorMessage } from './me'
import { profileEditSchema } from '@/lib/profile/schema'

const ctx = { userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false } as never
const GAME = '11111111-1111-4111-8111-111111111111'

const row = {
  username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: '+2348012345678', country: 'Nigeria',
  locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
  profile_completed_at: null as string | null, consent_whatsapp_updates: false,
}

describe('toMeResponse', () => {
  it('maps the profile row to camelCase and carries the role flags the app needs to show Admin', () => {
    const res = toMeResponse(ctx, { ...row, consent_whatsapp_updates: true, profile_completed_at: '2026-10-03T16:00:00.000Z' }, [GAME])
    expect(res).toEqual({
      id: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false,
      profile: {
        username: 'ada', displayName: 'Ada', avatarUrl: null, whatsappNumber: '+2348012345678', country: 'Nigeria',
        locale: 'en', membershipTier: 'guardian', kycVerified: false, deletionRequestedAt: null,
        profileCompletedAt: '2026-10-03T16:00:00.000Z', consentWhatsappUpdates: true, gameInterests: [GAME],
        equippedBubbleSkin: null, bubbleSkinUrl: null,
      },
    })
  })

  it('an INCOMPLETE profile reports profileCompletedAt null so the app shows onboarding', () => {
    const res = toMeResponse(ctx, row, [])
    expect(res.profile?.profileCompletedAt).toBeNull()
    expect(res.profile?.gameInterests).toEqual([])
  })

  it('a COMPLETED profile reports the server timestamp', () => {
    const res = toMeResponse(ctx, { ...row, profile_completed_at: '2026-10-03T16:00:00.000Z' }, [GAME])
    expect(res.profile?.profileCompletedAt).toBe('2026-10-03T16:00:00.000Z')
  })

  it('reports consent true and consent false as stored, never coerced', () => {
    expect(toMeResponse(ctx, { ...row, consent_whatsapp_updates: true }, []).profile?.consentWhatsappUpdates).toBe(true)
    expect(toMeResponse(ctx, { ...row, consent_whatsapp_updates: false }, []).profile?.consentWhatsappUpdates).toBe(false)
  })

  it('returns a null profile when the row does not exist yet', () => {
    expect(toMeResponse(ctx, null, []).profile).toBeNull()
  })

  it('defaults gameInterests to an empty array when none are passed', () => {
    expect(toMeResponse(ctx, row).profile?.gameInterests).toEqual([])
  })

  it('serializes a PostgreSQL UUID even when it has no RFC version nibble', () => {
    const response = toMeResponse(ctx, row, ['00000000-0000-0000-0000-0000000000a1'])

    expect(meResponse.safeParse(response).success).toBe(true)
  })
})

describe('PATCH /me/profile body — backward compatibility', () => {
  const legacyBody = { displayName: 'Ada', username: '', whatsapp: '', country: '', bio: '' }

  it('still accepts a body from an app version that does not know the new fields', () => {
    const parsed = profileEditSchema.safeParse(legacyBody)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.gameInterests).toBeUndefined()
      expect(parsed.data.consentWhatsappUpdates).toBeUndefined()
    }
  })

  it('accepts the new optional fields when sent', () => {
    expect(profileEditSchema.safeParse({ ...legacyBody, gameInterests: [GAME], consentWhatsappUpdates: false }).success).toBe(true)
  })
})

describe('updateProfileErrorMessage', () => {
  it('maps each UpdateProfileErrorCode to a player-facing message', () => {
    expect(updateProfileErrorMessage('username_taken')).toBe('That username is already taken.')
    expect(updateProfileErrorMessage('username_locked')).toBe('Username has already been changed once.')
    expect(updateProfileErrorMessage('save_failed')).toBe('Could not save your profile. Please try again.')
  })
})
