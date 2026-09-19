import { describe, it, expect } from 'vitest'
import { buildConfig, featureFlags } from './config'

describe('featureFlags', () => {
  it('enables every known feature by default', () => {
    const f = featureFlags(undefined)
    expect(Object.values(f).every((v) => v === true)).toBe(true)
    expect(Object.keys(f)).toEqual(
      expect.arrayContaining(['community', 'exchange', 'friendlies', 'messages', 'store', 'tv', 'wagering']),
    )
  })
  it('turns listed features off, tolerating spaces and unknown keys', () => {
    const f = featureFlags(' wagering , exchange ,nonsense')
    expect(f.wagering).toBe(false)
    expect(f.exchange).toBe(false)
    expect(f.store).toBe(true)
    expect('nonsense' in f).toBe(false)
  })
})

describe('buildConfig', () => {
  it('reports defaults with no env', () => {
    const c = buildConfig({})
    expect(c.minSupportedAppVersion).toBe('0.0.0')
    expect(c.latestAppVersion).toBe('1.0.0')
    expect(c.maintenance).toBeNull()
    expect(c.whatsappCommunityUrl).toBeNull()
    expect(c.coins).toEqual({ coinsPerNaira: 2, nairaPerCoin: 0.5, coinsPerEntry: 1000, coinsHalfEntry: 500 })
    expect(c.enforcePhoneVerification).toBe(false)
    expect(c.siteUrl).toMatch(/^https:\/\//)
  })
  it('reads overrides from env', () => {
    const c = buildConfig({
      MOBILE_MIN_APP_VERSION: '1.2.0',
      MOBILE_LATEST_APP_VERSION: '1.4.0',
      MOBILE_MAINTENANCE_MESSAGE: 'Back at 3pm',
      NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'https://chat.whatsapp.com/abc',
      MOBILE_FEATURES_OFF: 'wagering',
    })
    expect(c.minSupportedAppVersion).toBe('1.2.0')
    expect(c.latestAppVersion).toBe('1.4.0')
    expect(c.maintenance).toEqual({ message: 'Back at 3pm' })
    expect(c.whatsappCommunityUrl).toBe('https://chat.whatsapp.com/abc')
    expect(c.features.wagering).toBe(false)
  })
  it('treats the web placeholder "#" as no community link', () => {
    expect(buildConfig({ NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: '#' }).whatsappCommunityUrl).toBeNull()
  })
})
