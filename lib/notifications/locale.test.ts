import { describe, it, expect } from 'vitest'
import { toLocale, translatorFor } from './locale'

describe('toLocale', () => {
  it('accepts the supported locales', () => {
    expect(toLocale('en')).toBe('en')
    expect(toLocale('fr')).toBe('fr')
    expect(toLocale('pcm')).toBe('pcm')
  })

  // A notification must never fail to send because a profile row has a locale
  // we don't recognise — English is always a valid thing to say.
  it('falls back to en for anything else', () => {
    expect(toLocale(null)).toBe('en')
    expect(toLocale(undefined)).toBe('en')
    expect(toLocale('')).toBe('en')
    expect(toLocale('de')).toBe('en')
    expect(toLocale('EN')).toBe('en')
  })
})

describe('translatorFor', () => {
  it('renders from the requested catalog', async () => {
    const t = await translatorFor('pcm', 'auth.login')
    expect(t('submitting')).toBe('We dey sign you in…')
  })

  it('renders a different catalog for a different locale', async () => {
    const en = await translatorFor('en', 'auth.login')
    const pcm = await translatorFor('pcm', 'auth.login')
    expect(en('submitting')).not.toBe(pcm('submitting'))
  })

  // The whole point of Part 8: these run in cron routes and in deferred work
  // that outlives the response, where there is no request context to read a
  // locale from. createTranslator takes one explicitly; getTranslations cannot.
  it('works with no request context', async () => {
    const t = await translatorFor('en', 'auth.login')
    expect(t('title')).toBe('Welcome back')
  })

  it('interpolates values', async () => {
    const t = await translatorFor('en', 'emailChange')
    expect(t('pending', { email: 'a@b.com' })).toContain('a@b.com')
  })
})
