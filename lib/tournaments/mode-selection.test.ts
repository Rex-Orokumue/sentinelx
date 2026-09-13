import { describe, it, expect } from 'vitest'
import {
  formatsForMode,
  mapsForMode,
  matchRulesForMode,
  resolveModeSelection,
  type FormatOption,
  type ModeOption,
} from './mode-selection'

const br: ModeOption = {
  id: 'm-br',
  slug: 'battle_royale',
  name: 'Battle Royale',
  competitionFormat: 'points_race',
}
const cs: ModeOption = {
  id: 'm-cs',
  slug: 'clash_squad',
  name: 'Clash Squad',
  competitionFormat: 'head_to_head',
}

const brSolo: FormatOption = { id: 'f-solo', slug: 'solo', name: 'Solo', entryUnit: 'solo', teamSize: 1, available: true }
const brSquad: FormatOption = { id: 'f-sq', slug: 'squad', name: 'Squad', entryUnit: 'squad', teamSize: 4, available: false }
const cs1v1: FormatOption = { id: 'f-1v1', slug: '1v1', name: '1v1', entryUnit: 'solo', teamSize: 1, available: true }

describe('resolveModeSelection', () => {
  it('takes the engine from the mode, never from the admin', () => {
    // Mode DECIDES competition_format. The admin never picks it for a game
    // that has modes, so the two can never disagree.
    expect(resolveModeSelection(br, brSolo).competitionFormat).toBe('points_race')
    expect(resolveModeSelection(cs, cs1v1).competitionFormat).toBe('head_to_head')
  })

  it('writes entry unit and squad size from the format catalogue', () => {
    // The catalogue is the definition; these columns are the stored value.
    // Asking the admin separately is what would let them drift.
    expect(resolveModeSelection(br, brSquad)).toEqual({
      competitionFormat: 'points_race',
      entryUnit: 'squad',
      squadSize: 4,
    })
  })

  it('leaves squad size empty for a solo format', () => {
    // tournaments_squad_size_present requires squad_size IS NULL when the
    // entry unit is solo, and '' is what the schema maps to NULL.
    expect(resolveModeSelection(br, brSolo).squadSize).toBe('')
    expect(resolveModeSelection(cs, cs1v1).squadSize).toBe('')
  })

  it('falls back to a solo head-to-head tournament when no mode is chosen', () => {
    // A football game has no modes at all; the result must be exactly what
    // such a tournament stored before any of this existed.
    expect(resolveModeSelection(null, null)).toEqual({
      competitionFormat: 'head_to_head',
      entryUnit: 'solo',
      squadSize: '',
    })
  })

  it('ignores a format when no mode is selected', () => {
    // Defensive: a stale format from a previous mode must not leak settings.
    expect(resolveModeSelection(null, brSquad).entryUnit).toBe('solo')
  })

  it('uses the mode alone when the format is missing', () => {
    expect(resolveModeSelection(br, null)).toEqual({
      competitionFormat: 'points_race',
      entryUnit: 'solo',
      squadSize: '',
    })
  })
})

describe('formatsForMode', () => {
  const all = [
    { ...brSolo, modeId: 'm-br' },
    { ...brSquad, modeId: 'm-br' },
    { ...cs1v1, modeId: 'm-cs' },
  ]

  it('returns only the chosen mode’s formats', () => {
    expect(formatsForMode(all, 'm-br').map((f) => f.slug)).toEqual(['solo', 'squad'])
    expect(formatsForMode(all, 'm-cs').map((f) => f.slug)).toEqual(['1v1'])
  })

  it('keeps unavailable formats in the list', () => {
    // They render greyed as "Coming soon" — visible so the roadmap reads.
    // Filtering them out here would hide the roadmap entirely.
    expect(formatsForMode(all, 'm-br').some((f) => !f.available)).toBe(true)
  })

  it('returns nothing when no mode is selected', () => {
    expect(formatsForMode(all, null)).toEqual([])
  })
})

describe('mapsForMode', () => {
  const all = [
    { id: 'p1', name: 'Bermuda', modeId: 'm-br' },
    { id: 'p2', name: 'Alpine', modeId: 'm-br' },
    { id: 'p3', name: 'Iron Cage', modeId: 'm-lw' },
  ]

  it('returns only the chosen mode’s maps', () => {
    // The bug this prevents: Bermuda is a BR map, and the mock let you pick it
    // for a Clash Squad tournament.
    expect(mapsForMode(all, 'm-br').map((m) => m.name)).toEqual(['Bermuda', 'Alpine'])
  })

  it('returns the single map for a one-map mode', () => {
    expect(mapsForMode(all, 'm-lw')).toEqual([{ id: 'p3', name: 'Iron Cage' }])
  })

  it('returns nothing when no mode is selected', () => {
    expect(mapsForMode(all, null)).toEqual([])
  })
})

describe('matchRulesForMode', () => {
  // Match rules are scoped to a MODE, not global: a Free Fire tournament must
  // never offer PUBG's "TPP"/"FPP", and a PUBG one must never offer Free
  // Fire's "Headshot only" — the same cross-game leak the Mode->Format->Map
  // chain was built to prevent, now applying to a fourth field.
  const all = [
    { id: 'r-normal', name: 'Normal', modeId: 'm-cs' },
    { id: 'r-hs', name: 'Headshot only', modeId: 'm-cs' },
    { id: 'r-tpp', name: 'TPP', modeId: 'm-br' },
  ]

  it('returns only the chosen mode’s match rules', () => {
    expect(matchRulesForMode(all, 'm-cs').map((r) => r.name)).toEqual(['Normal', 'Headshot only'])
  })

  it('returns nothing when no mode is selected', () => {
    expect(matchRulesForMode(all, null)).toEqual([])
  })
})
