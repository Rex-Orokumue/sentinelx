import { describe, it, expect } from 'vitest'
import { toWhatsAppNumber, parsePlayerPhone, countryToRegion } from './number'

describe('countryToRegion', () => {
  it('resolves country names from the full ISO list', () => {
    expect(countryToRegion('Nigeria')).toBe('NG')
    expect(countryToRegion('South Africa')).toBe('ZA')
    expect(countryToRegion('Kenya')).toBe('KE')
    expect(countryToRegion('United Kingdom')).toBe('GB')
  })

  it('is case- and punctuation-insensitive', () => {
    expect(countryToRegion('  SOUTH   AFRICA ')).toBe('ZA')
    expect(countryToRegion("Côte d'Ivoire")).toBe('CI')
    expect(countryToRegion('cote divoire')).toBe('CI')
  })

  it('resolves demonyms and colloquial names players actually type', () => {
    // 'Nigerian' is present in live profile data alongside 'Nigeria'.
    expect(countryToRegion('Nigerian')).toBe('NG')
    expect(countryToRegion('naija')).toBe('NG')
    expect(countryToRegion('UK')).toBe('GB')
    expect(countryToRegion('USA')).toBe('US')
    expect(countryToRegion('Ivory Coast')).toBe('CI')
  })

  it('accepts a raw ISO code', () => {
    expect(countryToRegion('NG')).toBe('NG')
    expect(countryToRegion('ke')).toBe('KE')
  })

  it('falls back to Nigeria for missing or unrecognizable input', () => {
    expect(countryToRegion(null)).toBe('NG')
    expect(countryToRegion(undefined)).toBe('NG')
    expect(countryToRegion('')).toBe('NG')
    expect(countryToRegion('   ')).toBe('NG')
    expect(countryToRegion('Wakanda')).toBe('NG')
  })
})

describe('toWhatsAppNumber', () => {
  it('normalizes Nigerian local format', () => {
    expect(toWhatsAppNumber('08012345678')).toBe('2348012345678')
  })

  it('accepts an international Nigerian number', () => {
    expect(toWhatsAppNumber('+2348012345678')).toBe('2348012345678')
    expect(toWhatsAppNumber('2348012345678')).toBe('2348012345678')
  })

  it('accepts a bare 10-digit Nigerian subscriber number', () => {
    expect(toWhatsAppNumber('8012345678')).toBe('2348012345678')
  })

  it('ignores spaces and dashes', () => {
    expect(toWhatsAppNumber('080 123-45678')).toBe('2348012345678')
  })

  it('rejects too-short and empty input', () => {
    expect(toWhatsAppNumber('12345')).toBeNull()
    expect(toWhatsAppNumber('')).toBeNull()
    expect(toWhatsAppNumber(null)).toBeNull()
  })

  // The bug this module was written for: these are valid numbers in their own
  // country whose national format collides with Nigeria's.
  it("parses a South African national number against the player's country", () => {
    expect(toWhatsAppNumber('0821234567', { country: 'South Africa' })).toBe('27821234567')
  })

  it("parses a Kenyan national number against the player's country", () => {
    expect(toWhatsAppNumber('0712345678', { country: 'Kenya' })).toBe('254712345678')
  })

  it('refuses to invent a Nigerian number from a foreign national format', () => {
    // Previously '0712345678' became '2340712345678' — a real-looking wrong number.
    expect(toWhatsAppNumber('0712345678')).toBeNull()
    expect(toWhatsAppNumber('0704123456')).toBeNull()
  })

  it('honours a leading + regardless of the stated country', () => {
    expect(toWhatsAppNumber('+254712345678')).toBe('254712345678')
    expect(toWhatsAppNumber('+254712345678', { country: 'Nigeria' })).toBe('254712345678')
    expect(toWhatsAppNumber('+2348012345678', { country: 'Kenya' })).toBe('2348012345678')
  })

  it('validates against the real numbering plan, not just length', () => {
    // 11 digits, starts 0, but 0111... is not an allocated Nigerian mobile line.
    expect(toWhatsAppNumber('01112345678')).toBeNull()
  })
})

describe('parsePlayerPhone', () => {
  it('returns the wa.me, E.164 and display forms together', () => {
    expect(parsePlayerPhone('08012345678')).toEqual({
      waNumber: '2348012345678',
      e164: '+2348012345678',
      display: '+234 801 234 5678',
    })
  })

  it('formats a foreign number in its own conventions', () => {
    const p = parsePlayerPhone('0821234567', { country: 'South Africa' })
    expect(p!.e164).toBe('+27821234567')
    expect(p!.display).toBe('+27 82 123 4567')
  })

  it('returns null rather than a partial result for an invalid number', () => {
    expect(parsePlayerPhone('0704123456', { country: 'Nigeria' })).toBeNull()
  })
})
