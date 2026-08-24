import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/i18n/locales'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import pcm from '@/messages/pcm.json'

const CATALOGS: Record<string, unknown> = { en, fr, pcm }

// Flattens nested keys to dotted paths, e.g. { nav: { home: 'x' } } -> ['nav.home'],
// so a missing/extra key at any nesting depth in any locale fails the test.
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('message catalog key parity', () => {
  const englishKeys = flattenKeys(en).sort()

  it('every locale defines exactly the same keys as en.json', () => {
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const keys = flattenKeys(CATALOGS[locale]).sort()
      expect(keys, `${locale}.json key set must match en.json`).toEqual(englishKeys)
    }
  })
})
