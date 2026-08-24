import { describe, it, expect } from 'vitest'
import { splitLocaleFromPathname, withLocalePrefix } from './locale-path'

describe('splitLocaleFromPathname', () => {
  it('returns the default locale and unchanged path when there is no prefix', () => {
    expect(splitLocaleFromPathname('/tournaments/x')).toEqual({ locale: 'en', pathname: '/tournaments/x' })
  })

  it('strips a recognized locale prefix', () => {
    expect(splitLocaleFromPathname('/fr/tournaments/x')).toEqual({ locale: 'fr', pathname: '/tournaments/x' })
    expect(splitLocaleFromPathname('/pcm/dashboard')).toEqual({ locale: 'pcm', pathname: '/dashboard' })
  })

  it('treats a bare locale-prefixed root as "/"', () => {
    expect(splitLocaleFromPathname('/fr')).toEqual({ locale: 'fr', pathname: '/' })
  })

  it('does not strip a path segment that merely starts with a locale code', () => {
    // '/frankenstein' must not be misread as locale 'fr' + pathname 'ankenstein'
    expect(splitLocaleFromPathname('/frankenstein')).toEqual({ locale: 'en', pathname: '/frankenstein' })
  })
})

describe('withLocalePrefix', () => {
  it('adds no prefix for the default locale', () => {
    expect(withLocalePrefix('/tournaments/x', 'en')).toBe('/tournaments/x')
  })

  it('prefixes non-default locales', () => {
    expect(withLocalePrefix('/tournaments/x', 'fr')).toBe('/fr/tournaments/x')
    expect(withLocalePrefix('/', 'pcm')).toBe('/pcm')
  })
})
