import { describe, it, expect } from 'vitest'
import { profileEditSchema } from './schema'

const base = { displayName: 'Ada', username: '', whatsapp: '', country: '', bio: '' }

describe('profileEditSchema', () => {
  it('accepts a blank whatsapp with any country (nothing to cross-validate)', () => {
    expect(profileEditSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a whatsapp number valid for the given country', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: 'Nigeria' }).success).toBe(true)
  })

  it('rejects a whatsapp number that is the wrong shape for the given country', () => {
    const result = profileEditSchema.safeParse({ ...base, whatsapp: '0821234567', country: 'Nigeria' })
    expect(result.success).toBe(false)
  })

  it('resolves a legacy free-text country via the existing alias table', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: 'Nigerian' }).success).toBe(true)
  })

  it('defaults to Nigeria when country is blank', () => {
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '08012345678', country: '' }).success).toBe(true)
    expect(profileEditSchema.safeParse({ ...base, whatsapp: '0821234567', country: '' }).success).toBe(false)
  })

  it('accepts gameInterests and consentWhatsappUpdates when provided', () => {
    const result = profileEditSchema.safeParse({
      ...base,
      gameInterests: ['11111111-1111-4111-8111-111111111111'],
      consentWhatsappUpdates: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts the omission of gameInterests and consentWhatsappUpdates (leave-unchanged semantics)', () => {
    const result = profileEditSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.gameInterests).toBeUndefined()
      expect(result.data.consentWhatsappUpdates).toBeUndefined()
    }
  })

  it('rejects a non-uuid entry in gameInterests', () => {
    expect(profileEditSchema.safeParse({ ...base, gameInterests: ['not-a-uuid'] }).success).toBe(false)
  })
})
