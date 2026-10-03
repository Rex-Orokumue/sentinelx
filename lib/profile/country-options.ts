import { knownCountryRegion, listCountries } from '@/lib/phone/number'

// What the Settings country <select> shows for a player's stored country.
//
// profiles.country was free text for most of the platform's life, so a stored
// value can be canonical ("Nigeria"), a spelling the phone module recognizes
// ("Nigerian", "naija"), or something it doesn't ("Lagos"). A plain <select>
// would silently drop the last kind and send "" on the next save, erasing it.
//
// Server-side only (see lib/phone/country-list-server-only.test.ts): the page
// calls this and passes the result to the form as a prop.
export interface SettingsCountryOptions {
  countries: { code: string; name: string }[]
  selected: string
  legacyOption: string | null
}

export function settingsCountryOptions(stored: string | null | undefined): SettingsCountryOptions {
  const countries = listCountries()
  const value = (stored ?? '').trim()
  if (!value) return { countries, selected: '', legacyOption: null }

  const region = knownCountryRegion(value)
  const canonical = region ? countries.find((c) => c.code === region)?.name : undefined
  if (canonical) return { countries, selected: canonical, legacyOption: null }

  return { countries, selected: value, legacyOption: value }
}
