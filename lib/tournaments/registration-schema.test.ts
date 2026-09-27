import { describe, it, expect } from 'vitest'
import { fixedRegistrationSchema } from './registration-schema'

const valid = { displayName: 'Samuel O.', whatsapp: '+2348012345678' }

describe('fixedRegistrationSchema', () => {
  it('accepts valid input', () => {
    expect(fixedRegistrationSchema.safeParse(valid).success).toBe(true)
  })

  it('requires displayName', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, displayName: '  ' }).success).toBe(false)
  })

  it('requires a plausible WhatsApp number', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, whatsapp: 'not a number' }).success).toBe(false)
  })

  it('accepts a WhatsApp number without a leading +', () => {
    expect(fixedRegistrationSchema.safeParse({ ...valid, whatsapp: '08012345678' }).success).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    const r = fixedRegistrationSchema.safeParse({ ...valid, displayName: '  Samuel O.  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.displayName).toBe('Samuel O.')
  })
})
