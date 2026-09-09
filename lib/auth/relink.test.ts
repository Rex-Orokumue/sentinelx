import { describe, it, expect } from 'vitest'
import { willGoogleRelink } from './relink'

describe('willGoogleRelink', () => {
  it('warns when the account and Google addresses match', () => {
    expect(willGoogleRelink({ accountEmail: 'a@gmail.com', googleEmail: 'a@gmail.com' })).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(willGoogleRelink({ accountEmail: ' A@Gmail.com ', googleEmail: 'a@gmail.com' })).toBe(true)
  })

  // A changed address is exactly what makes the unlink stick: the next Google
  // sign-in has nothing to match, so it creates a new account instead.
  it('stays quiet once the email has been changed away', () => {
    expect(willGoogleRelink({ accountEmail: 'a+sx@gmail.com', googleEmail: 'a@gmail.com' })).toBe(false)
  })

  it('says nothing when either address is unknown', () => {
    expect(willGoogleRelink({ accountEmail: null, googleEmail: 'a@gmail.com' })).toBe(false)
    expect(willGoogleRelink({ accountEmail: 'a@gmail.com', googleEmail: null })).toBe(false)
  })
})
