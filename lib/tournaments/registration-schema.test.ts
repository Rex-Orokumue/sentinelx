import { describe, it, expect } from 'vitest'
import { registrationDetailsSchema } from './registration-schema'

const valid = {
  displayName: 'Samuel O.',
  whatsapp: '+2348012345678',
  clubName: 'Lagos Ronin',
  ignTag: 'DarkStrikerNG',
}

describe('registrationDetailsSchema', () => {
  it('accepts valid input', () => {
    expect(registrationDetailsSchema.safeParse(valid).success).toBe(true)
  })

  it('requires displayName', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, displayName: '  ' }).success).toBe(false)
  })

  it('requires clubName', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, clubName: '' }).success).toBe(false)
  })

  it('requires ignTag', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, ignTag: '' }).success).toBe(false)
  })

  it('requires a plausible WhatsApp number', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, whatsapp: 'not a number' }).success).toBe(
      false,
    )
  })

  it('accepts a WhatsApp number without a leading +', () => {
    expect(registrationDetailsSchema.safeParse({ ...valid, whatsapp: '08012345678' }).success).toBe(
      true,
    )
  })

  it('trims surrounding whitespace', () => {
    const r = registrationDetailsSchema.safeParse({ ...valid, displayName: '  Samuel O.  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.displayName).toBe('Samuel O.')
  })
})
