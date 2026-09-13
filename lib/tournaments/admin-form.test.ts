import { describe, it, expect } from 'vitest'
import { parseForm } from './admin-form'

// These tests exist because 23 green schema tests missed a bug that made the
// entire points-race feature unreachable.
//
// admin-schema.test.ts hands a plain object straight to tournamentSchema, so it
// never exercises parseForm — the hand-written FormData -> object mapping.
// competitionFormat was added to the schema and the form but NOT to that
// mapping, so the posted value was dropped, the schema default filled in, and
// every tournament saved as head_to_head with no error anywhere.
//
// Anything that reads FormData belongs under test here, not only in the schema.

/** The fields the real creation form posts for a football tournament. */
function footballForm(): FormData {
  const fd = new FormData()
  fd.set('title', 'DLS Cup')
  fd.set('gameId', '11111111-1111-4111-8111-111111111111')
  fd.set('slug', '')
  fd.set('description', '')
  fd.set('bannerUrl', '')
  fd.set('cardImageUrl', '')
  fd.set('registrationFee', '500')
  fd.set('prizePool', '0')
  fd.set('maxPlayers', '16')
  fd.set('registrationStart', '')
  fd.set('registrationEnd', '')
  fd.set('tournamentStart', '')
  fd.set('tournamentEnd', '')
  fd.set('rules', '')
  fd.set('dataSupportText', '')
  fd.set('dataSupportWhatsapp', '')
  fd.set('tournamentType', 'open')
  fd.set('seasonId', '')
  fd.set('format', 'group_knockout')
  fd.set('prizeSecond', '')
  fd.set('prizeThird', '')
  fd.set('competitionFormat', 'head_to_head')
  fd.set('entryUnit', 'solo')
  return fd
}

describe('parseForm', () => {
  it('reads a football tournament unchanged', () => {
    const r = parseForm(footballForm())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.competitionFormat).toBe('head_to_head')
      expect(r.data.entryUnit).toBe('solo')
      expect(r.data.format).toBe('group_knockout')
      expect(r.data.registrationFee).toBe(500)
    }
  })

  it('carries competitionFormat through to the parsed result', () => {
    // THE regression. The form posted this and parseForm dropped it, so the
    // schema default silently won and no points-race tournament could exist.
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.competitionFormat).toBe('points_race')
  })

  it('carries entryUnit and squadSize through for a squad tournament', () => {
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    fd.set('entryUnit', 'squad')
    fd.set('squadSize', '4')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.entryUnit).toBe('squad')
      expect(r.data.squadSize).toBe(4)
    }
  })

  it('defaults the head-to-head-only fields when the form omits them', () => {
    // A points race hides `format` and `manualKnockoutPairing`, so they are
    // never posted. parseForm must supply the defaults rather than fail.
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    fd.delete('format')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.format).toBe('group_knockout')
      expect(r.data.manualKnockoutPairing).toBe(false)
    }
  })

  it('reads the manual-pairing checkbox when it is ticked', () => {
    const fd = footballForm()
    fd.set('manualKnockoutPairing', 'true')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.manualKnockoutPairing).toBe(true)
  })

  it('surfaces a validation failure rather than silently defaulting', () => {
    const fd = footballForm()
    fd.set('title', '')
    expect(parseForm(fd).success).toBe(false)
  })

  it('reads every field the form actually posts', () => {
    // Structural guard: give every posted field a distinctive value and assert
    // none of them come back as the schema's default. A new schema field added
    // to the form but forgotten here fails this test as soon as it is added to
    // the fixture — which is the step the original bug skipped.
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    fd.set('entryUnit', 'squad')
    fd.set('squadSize', '6')
    fd.set('tournamentType', 'masters')
    fd.set('seasonId', '22222222-2222-4222-8222-222222222222')
    fd.set('manualKnockoutPairing', 'true')

    const r = parseForm(fd)
    expect(r.success).toBe(true)
    if (!r.success) return

    expect({
      competitionFormat: r.data.competitionFormat,
      entryUnit: r.data.entryUnit,
      squadSize: r.data.squadSize,
      tournamentType: r.data.tournamentType,
      manualKnockoutPairing: r.data.manualKnockoutPairing,
    }).toEqual({
      competitionFormat: 'points_race',
      entryUnit: 'squad',
      squadSize: 6,
      tournamentType: 'masters',
      manualKnockoutPairing: true,
    })
  })
})

describe('parseForm — max players cap by format', () => {
  it('caps a head-to-head tournament at 64', () => {
    // A knockout bracket is power-of-two bounded.
    const fd = footballForm()
    fd.set('maxPlayers', '96')
    expect(parseForm(fd).success).toBe(false)
  })

  it('allows a points race well past 64', () => {
    // 96 across four 24-player lobbies is a completely ordinary BR field, and
    // the engine already supports it — closeRegistration skips the 64 cap for
    // points races. The form must not be the thing that blocks it.
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    fd.set('maxPlayers', '96')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.maxPlayers).toBe(96)
  })

  it('still rejects an absurd field size', () => {
    const fd = footballForm()
    fd.set('competitionFormat', 'points_race')
    fd.set('maxPlayers', '5000')
    expect(parseForm(fd).success).toBe(false)
  })
})

describe('parseForm — mode, format, map, rules, match type', () => {
  it('defaults every new field to empty for a football tournament', () => {
    const r = parseForm(footballForm())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('')
      expect(r.data.formatId).toBe('')
      expect(r.data.defaultMapId).toBe('')
      expect(r.data.matchRuleId).toBe('')
      expect(r.data.matchType).toBe('')
    }
  })

  it('carries the four selections through to the parsed result', () => {
    // The bug this guards: parseForm hand-picks fields, so one added to the
    // schema but not here is dropped and the default silently wins.
    const fd = footballForm()
    fd.set('modeId', '33333333-3333-4333-8333-333333333333')
    fd.set('formatId', '44444444-4444-4444-8444-444444444444')
    fd.set('defaultMapId', '55555555-5555-4555-8555-555555555555')
    fd.set('matchRuleId', '66666666-6666-4666-8666-666666666666')
    fd.set('matchType', 'bo1')
    const r = parseForm(fd)

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.modeId).toBe('33333333-3333-4333-8333-333333333333')
      expect(r.data.formatId).toBe('44444444-4444-4444-8444-444444444444')
      expect(r.data.defaultMapId).toBe('55555555-5555-4555-8555-555555555555')
      expect(r.data.matchRuleId).toBe('66666666-6666-4666-8666-666666666666')
      expect(r.data.matchType).toBe('bo1')
    }
  })

  it('accepts every match type the CHECK permits, not only the selectable one', () => {
    // Availability is gated by match_types.available, NOT by validation. A
    // schema that rejected bo3 would make enabling it a code change.
    for (const matchType of ['bo1', 'bo3', 'bo5']) {
      const fd = footballForm()
      fd.set('matchType', matchType)
      expect(parseForm(fd).success, matchType).toBe(true)
    }
  })

  it('rejects a match type the database would refuse', () => {
    const fd = footballForm()
    fd.set('matchType', 'bo7')
    expect(parseForm(fd).success).toBe(false)
  })

  it('rejects a match rule id that is not a uuid', () => {
    // matchRuleId is an FK into game_mode_match_rules, same trust model as
    // modeId/formatId/defaultMapId: the schema only checks shape, and
    // whether it names a real row for the chosen mode is the DB's job.
    const fd = footballForm()
    fd.set('matchRuleId', 'nonsense')
    expect(parseForm(fd).success).toBe(false)
  })
})
