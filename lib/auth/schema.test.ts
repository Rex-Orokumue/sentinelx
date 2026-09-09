import { describe, it, expect } from 'vitest'
import { usernameSchema, signupSchema, loginSchema, changeEmailSchema } from './schema'

describe('usernameSchema', () => {
  it('accepts a valid handle', () => {
    expect(usernameSchema.safeParse('Rex_99').success).toBe(true)
  })
  it('rejects too short', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
  })
  it('rejects illegal characters', () => {
    expect(usernameSchema.safeParse('bad name!').success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid input', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1' })
    expect(r.success).toBe(true)
  })
  it('rejects short password', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'short' })
    expect(r.success).toBe(false)
  })
  it('accepts an optional ref code', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1', ref: 'someone' })
    expect(r.success).toBe(true)
  })
  it('accepts signup with no ref code', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1' })
    expect(r.success).toBe(true)
  })
})

describe('loginSchema', () => {
  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
  })
})

describe('changeEmailSchema', () => {
  it('accepts a new address with the current password', () => {
    expect(changeEmailSchema.safeParse({ email: 'new@b.com', password: 'password1' }).success).toBe(true)
  })
  it('rejects an invalid address', () => {
    expect(changeEmailSchema.safeParse({ email: 'nope', password: 'password1' }).success).toBe(false)
  })
  it('rejects a blank password, so re-auth cannot be skipped', () => {
    expect(changeEmailSchema.safeParse({ email: 'new@b.com', password: '' }).success).toBe(false)
  })
  it('trims surrounding whitespace off the address', () => {
    const r = changeEmailSchema.safeParse({ email: '  new@b.com  ', password: 'password1' })
    expect(r.success && r.data.email).toBe('new@b.com')
  })
})
