import { describe, it, expect } from 'vitest'
import { onboardingProfileSchema, parseOnboardingProfileFormData } from './profile-schema'

describe('onboardingProfileSchema', () => {
  const valid = {
    country: 'Nigeria',
    whatsapp: '08012345678',
    consentWhatsappUpdates: 'true' as const,
    gameInterests: ['11111111-1111-4111-8111-111111111111'],
  }

  it('accepts a fully filled submission', () => {
    expect(onboardingProfileSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a blank country', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, country: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank whatsapp number', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, whatsapp: '' })
    expect(result.success).toBe(false)
  })

  it('rejects zero game interests', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, gameInterests: [] })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid game interest', () => {
    const result = onboardingProfileSchema.safeParse({ ...valid, gameInterests: ['not-a-uuid'] })
    expect(result.success).toBe(false)
  })

  it('accepts consent as the literal string "false" (an explicit no is valid)', () => {
    expect(onboardingProfileSchema.safeParse({ ...valid, consentWhatsappUpdates: 'false' }).success).toBe(true)
  })

  it('rejects consent as anything other than the strings "true"/"false"', () => {
    expect(onboardingProfileSchema.safeParse({ ...valid, consentWhatsappUpdates: undefined }).success).toBe(false)
  })
})

describe('parseOnboardingProfileFormData', () => {
  it('reads a single-select country/whatsapp, repeated gameInterests entries, and the consent hidden input', () => {
    const fd = new FormData()
    fd.set('country', 'Ghana')
    fd.set('whatsapp', '0244123456')
    fd.set('consentWhatsappUpdates', 'true')
    fd.append('gameInterests', '11111111-1111-4111-8111-111111111111')
    fd.append('gameInterests', '22222222-2222-4222-8222-222222222222')

    expect(parseOnboardingProfileFormData(fd)).toEqual({
      country: 'Ghana',
      whatsapp: '0244123456',
      consentWhatsappUpdates: 'true',
      gameInterests: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    })
  })

  it('produces an empty gameInterests array (not undefined) when no checkbox was checked', () => {
    const fd = new FormData()
    fd.set('country', 'Ghana')
    fd.set('whatsapp', '0244123456')
    fd.set('consentWhatsappUpdates', 'false')
    expect(parseOnboardingProfileFormData(fd)).toMatchObject({ gameInterests: [] })
  })

  it('defaults missing country/whatsapp/consent to empty strings rather than throwing', () => {
    const fd = new FormData()
    expect(parseOnboardingProfileFormData(fd)).toEqual({
      country: '',
      whatsapp: '',
      consentWhatsappUpdates: '',
      gameInterests: [],
    })
  })
})
