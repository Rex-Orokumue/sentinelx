import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// listCountries() builds names with Intl.DisplayNames, and Node and each browser
// disagree on a few of them ("Falkland Islands" vs "Falkland Islands (Islas
// Malvinas)", Türkiye vs Turkey, Czechia vs Czech Republic). Called inside a
// client component it (a) makes the server HTML differ from the client render —
// a hydration error — and (b) lets the string saved to profiles.country depend
// on the player's browser, which splits one country into two in the admin
// segment (it filters on the exact stored value). So the list must be built in a
// server component and handed down as props.

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

describe('the country list', () => {
  // settingsCountryOptions() calls listCountries() underneath, so it has the same rule.
  it('is never built in a client component (listCountries / settingsCountryOptions)', () => {
    const offenders = ['components', 'app']
      .flatMap((d) => sourceFiles(join(process.cwd(), d)))
      .filter((file) => {
        const src = readFileSync(file, 'utf8')
        return /^\s*['"]use client['"]/m.test(src) && /\b(listCountries|settingsCountryOptions)\s*\(/.test(src)
      })
    expect(offenders).toEqual([])
  })
})
