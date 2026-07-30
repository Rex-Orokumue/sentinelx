import { parsePhoneNumberFromString, getCountries, type CountryCode } from 'libphonenumber-js'

// Sentinel X is Nigeria-first, so a player who told us nothing about where they
// are is assumed Nigerian. But the platform genuinely has players elsewhere in
// Africa, and their national formats collide with Nigeria's: a South African
// mobile is 10 digits starting '0', a Kenyan one likewise. Parsing those as
// Nigerian used to invent a plausible-looking wrong number, which is worse than
// failing — WhatsApp links opened a stranger's chat and OTP codes could be
// delivered to them. Hence: parse against the player's own country.
const DEFAULT_REGION: CountryCode = 'NG'

// Lowercase, accent-stripped, letters only — so "Côte d'Ivoire", "cote divoire"
// and "COTE D IVOIRE" all collapse to the same lookup key.
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

// Country name → ISO region, derived from Intl's own region list rather than a
// hand-maintained table, so all 245 countries resolve and nobody has to curate
// it as the player base spreads.
const REGION_BY_NAME: Map<string, CountryCode> = (() => {
  const index = new Map<string, CountryCode>()
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const code of getCountries()) {
    const name = display.of(code)
    if (name) index.set(normalizeName(name), code)
    index.set(normalizeName(code), code) // "NG" typed directly
  }
  return index
})()

// What Intl can't cover: `profiles.country` is a free-text field, so players
// write demonyms ("Nigerian") and colloquial names. Live data already contains
// "Nigerian" alongside "Nigeria".
const ALIASES: Record<string, CountryCode> = {
  nigerian: 'NG',
  naija: 'NG',
  ghanaian: 'GH',
  kenyan: 'KE',
  southafrican: 'ZA',
  ugandan: 'UG',
  tanzanian: 'TZ',
  cameroonian: 'CM',
  ivorian: 'CI',
  ivorycoast: 'CI',
  senegalese: 'SN',
  egyptian: 'EG',
  moroccan: 'MA',
  rwandan: 'RW',
  zambian: 'ZM',
  zimbabwean: 'ZW',
  uk: 'GB',
  british: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  northernireland: 'GB',
  usa: 'US',
  america: 'US',
  american: 'US',
  uae: 'AE',
  emirati: 'AE',
  canadian: 'CA',
  irish: 'IE',
  german: 'DE',
  french: 'FR',
  italian: 'IT',
  spanish: 'ES',
  indian: 'IN',
  chinese: 'CN',
  brazilian: 'BR',
}

/** Free-text country → ISO region for phone parsing. Falls back to Nigeria. */
export function countryToRegion(country: string | null | undefined): CountryCode {
  if (!country) return DEFAULT_REGION
  const key = normalizeName(country)
  if (!key) return DEFAULT_REGION
  return ALIASES[key] ?? REGION_BY_NAME.get(key) ?? DEFAULT_REGION
}

export interface PlayerPhone {
  /** Digits only, no '+' — the form wa.me requires: "2348012345678". */
  waNumber: string
  /** E.164: "+2348012345678". */
  e164: string
  /** Human-readable international: "+234 801 234 5678". */
  display: string
}

/**
 * Parses a free-typed number against the player's country and validates it
 * against that country's real numbering plan. Returns null for anything that
 * isn't a genuinely valid number — we would rather show "no WhatsApp" than
 * hand someone a link to a number we guessed at.
 *
 * A leading '+' makes the number self-describing, and the region is ignored.
 */
export function parsePlayerPhone(
  raw: string | null | undefined,
  opts?: { country?: string | null },
): PlayerPhone | null {
  if (!raw) return null
  const parsed = parsePhoneNumberFromString(raw.trim(), countryToRegion(opts?.country))
  if (!parsed || !parsed.isValid()) return null
  return {
    waNumber: parsed.number.replace('+', ''),
    e164: parsed.number,
    display: parsed.formatInternational(),
  }
}

/** The wa.me form of a player's number, or null when it isn't a valid number. */
export function toWhatsAppNumber(
  raw: string | null | undefined,
  opts?: { country?: string | null },
): string | null {
  return parsePlayerPhone(raw, opts)?.waNumber ?? null
}
