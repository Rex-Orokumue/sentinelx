import { tournamentSchema } from './admin-schema'

// EVERY field the schema defines must be listed here. This mapping is
// hand-written, so a field added to tournamentSchema but not to this function
// is silently dropped, the schema's default fills in, and the value the admin
// chose never reaches the database — with no error anywhere.
//
// That is exactly what happened to competitionFormat: the form posted
// points_race, this function did not read it, and every tournament saved as
// head_to_head. Schema tests did not catch it because they hand an object
// straight to tournamentSchema and never exercise this mapping. The round-trip
// tests in admin-actions.test.ts do, and they are the guard against a repeat.
export function parseForm(formData: FormData) {
  return tournamentSchema.safeParse({
    title: formData.get('title'),
    gameId: formData.get('gameId'),
    slug: formData.get('slug') ?? '',
    description: formData.get('description') ?? '',
    bannerUrl: formData.get('bannerUrl') ?? '',
    cardImageUrl: formData.get('cardImageUrl') ?? '',
    registrationFee: formData.get('registrationFee'),
    prizePool: formData.get('prizePool'),
    maxPlayers: formData.get('maxPlayers') ?? '',
    registrationStart: formData.get('registrationStart') ?? '',
    registrationEnd: formData.get('registrationEnd') ?? '',
    tournamentStart: formData.get('tournamentStart') ?? '',
    tournamentEnd: formData.get('tournamentEnd') ?? '',
    rules: formData.get('rules') ?? '',
    dataSupportText: formData.get('dataSupportText') ?? '',
    dataSupportWhatsapp: formData.get('dataSupportWhatsapp') ?? '',
    tournamentType: formData.get('tournamentType') ?? 'open',
    seasonId: formData.get('seasonId') ?? '',
    format: formData.get('format') ?? 'group_knockout',
    manualKnockoutPairing: formData.get('manualKnockoutPairing') ?? 'false',
    competitionFormat: formData.get('competitionFormat') ?? 'head_to_head',
    entryUnit: formData.get('entryUnit') ?? 'solo',
    squadSize: formData.get('squadSize') ?? '',
    modeId: formData.get('modeId') ?? '',
    formatId: formData.get('formatId') ?? '',
    defaultMapId: formData.get('defaultMapId') ?? '',
    matchRules: formData.get('matchRules') ?? '',
    matchType: formData.get('matchType') ?? '',
    prizeSecond: formData.get('prizeSecond') ?? '',
    prizeThird: formData.get('prizeThird') ?? '',
  })
}

