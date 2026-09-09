import { describe, it, expect } from 'vitest'
import { hasPasswordIdentity } from './reauth'

describe('hasPasswordIdentity', () => {
  it('finds the password on an email account', () => {
    expect(hasPasswordIdentity({ identities: [{ provider: 'email' }] as never })).toBe(true)
  })

  it('reports no password for a Google-only account', () => {
    expect(hasPasswordIdentity({ identities: [{ provider: 'google' }] as never })).toBe(false)
  })

  it('finds the password when Google was linked to an email account', () => {
    expect(
      hasPasswordIdentity({ identities: [{ provider: 'google' }, { provider: 'email' }] as never }),
    ).toBe(true)
  })

  // Failing open is deliberate — see the note in reauth.ts. verifyPassword is
  // the real gate, and guessing "no password" here would send a password user
  // off to set one they already have.
  it('assumes a password exists when identities are missing', () => {
    expect(hasPasswordIdentity({ identities: undefined })).toBe(true)
  })

  it('reports no password for an account with an empty identity list', () => {
    expect(hasPasswordIdentity({ identities: [] })).toBe(false)
  })
})
