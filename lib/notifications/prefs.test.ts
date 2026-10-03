import { describe, it, expect } from 'vitest'
import { effectivePrefs, isPushEnabled, patchPrefsSchema, PUSH_PREF_KEYS, WHATSAPP_PREF_KEYS, SHARING_PREF_KEYS } from './prefs'

describe('effectivePrefs', () => {
  it('has 17 push, 6 whatsapp and 5 sharing keys', () => {
    expect(PUSH_PREF_KEYS).toHaveLength(17)
    expect(WHATSAPP_PREF_KEYS).toHaveLength(6)
    expect(SHARING_PREF_KEYS).toHaveLength(5)
  })
  it('treats every absent push key as on', () => {
    const p = effectivePrefs(null).push
    expect(Object.values(p).every((v) => v === true)).toBe(true)
    expect(Object.keys(p)).toHaveLength(17)
  })
  it('pins the whatsapp and sharing defaults to the settings page', () => {
    const e = effectivePrefs({})
    expect(e.whatsapp).toEqual({
      match_reminder: true, result_confirmed: true, prize_credited: true,
      challenge_completed: false, achievement_unlocked: false, registration_confirmed: true,
    })
    expect(e.achievementSharing).toEqual({ tournament: true, milestone: true, streak: true, social: false, other: false })
  })
  it('only an explicit false turns a key off; junk values fall back to the default', () => {
    const e = effectivePrefs({ push: { post_reaction: false, match_reminder: 'no', new_follower: 0 }, whatsapp: { challenge_completed: true } })
    expect(e.push.post_reaction).toBe(false)
    expect(e.push.match_reminder).toBe(true)
    expect(e.push.new_follower).toBe(true)
    expect(e.whatsapp.challenge_completed).toBe(true)
  })
  it('ignores unknown stored keys', () => {
    expect(Object.keys(effectivePrefs({ push: { zzz: false } }).push)).not.toContain('zzz')
  })
  it('does not throw on non-object input', () => {
    expect(() => effectivePrefs('x')).not.toThrow()
    expect(() => effectivePrefs([])).not.toThrow()
  })
})

describe('isPushEnabled', () => {
  it('matches the sender rule: only === false suppresses; a type with no stored key (status_removed) sends', () => {
    expect(isPushEnabled({ push: { post_comment: false } }, 'post_comment')).toBe(false)
    expect(isPushEnabled({ push: {} }, 'post_comment')).toBe(true)
    expect(isPushEnabled(null, 'post_comment')).toBe(true)
    expect(isPushEnabled({ push: {} }, 'status_removed')).toBe(true) // no key is ever stored, so it always sends
  })
})

describe('patchPrefsSchema', () => {
  it('accepts partial sections and an empty object', () => {
    expect(patchPrefsSchema.safeParse({}).success).toBe(true)
    expect(patchPrefsSchema.safeParse({ push: { post_comment: false } }).success).toBe(true)
  })
  it('rejects unknown keys at any level and non-booleans', () => {
    expect(patchPrefsSchema.safeParse({ push: { nope: true } }).success).toBe(false)
    expect(patchPrefsSchema.safeParse({ extra: {} }).success).toBe(false)
    expect(patchPrefsSchema.safeParse({ push: { post_comment: 'yes' } }).success).toBe(false)
  })
  it('does not allow status_removed to be toggled', () => {
    expect(patchPrefsSchema.safeParse({ push: { status_removed: false } }).success).toBe(false)
  })
})
