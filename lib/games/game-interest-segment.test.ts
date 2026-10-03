import { describe, it, expect } from 'vitest'
import { groupGameInterestRows, buildContactCsv, buildContactNumbers } from './game-interest-segment'

const raw = [
  { user_id: 'u1', profiles: { id: 'u1', username: 'ada', display_name: 'Ada', country: 'Nigeria', whatsapp_number: '+2348012345678', consent_whatsapp_updates: true }, games: { name: 'EA FC Mobile' } },
  { user_id: 'u1', profiles: { id: 'u1', username: 'ada', display_name: 'Ada', country: 'Nigeria', whatsapp_number: '+2348012345678', consent_whatsapp_updates: true }, games: { name: 'eFootball' } },
  { user_id: 'u2', profiles: { id: 'u2', username: 'bola', display_name: 'Bola', country: 'Ghana', whatsapp_number: '+233244123456', consent_whatsapp_updates: true }, games: { name: 'EA FC Mobile' } },
]

describe('groupGameInterestRows', () => {
  it('collapses a player interested in multiple games into one row with a combined game label', () => {
    const grouped = groupGameInterestRows(raw)
    expect(grouped).toHaveLength(2)
    const ada = grouped.find((p) => p.id === 'u1')
    expect(ada?.games).toBe('EA FC Mobile, eFootball')
  })

  it('keeps each distinct player as a separate row', () => {
    const grouped = groupGameInterestRows(raw)
    expect(grouped.map((p) => p.id).sort()).toEqual(['u1', 'u2'])
  })

  it('returns an empty list for an empty input', () => {
    expect(groupGameInterestRows([])).toEqual([])
  })
})

describe('buildContactNumbers', () => {
  it('returns each grouped player\'s E.164 number once', () => {
    const grouped = groupGameInterestRows(raw)
    expect(buildContactNumbers(grouped).sort()).toEqual(['+233244123456', '+2348012345678'])
  })
})

describe('buildContactCsv', () => {
  it('produces a header row plus one row per player with name, country, number, and combined games', () => {
    const grouped = groupGameInterestRows(raw)
    const csv = buildContactCsv(grouped)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,country,whatsapp_number,game_interests')
    expect(lines).toContain('Ada,Nigeria,+2348012345678,"EA FC Mobile, eFootball"')
    expect(lines).toContain('Bola,Ghana,+233244123456,EA FC Mobile')
  })

  it('falls back to username when display_name is null', () => {
    const withNullName = [{ ...raw[2], profiles: { ...raw[2].profiles, display_name: null } }]
    const grouped = groupGameInterestRows(withNullName)
    expect(buildContactCsv(grouped)).toContain('bola,Ghana,+233244123456,EA FC Mobile')
  })

  // Display names are player-typed, so the export has to survive hostile ones.
  it('escapes embedded quotes by doubling them and keeps a newline inside one field', () => {
    const named = [{ ...raw[2], profiles: { ...raw[2].profiles, display_name: 'Bo "the" la\nx' } }]
    const csv = buildContactCsv(groupGameInterestRows(named))
    expect(csv).toContain('"Bo ""the"" la\nx",Ghana,+233244123456,EA FC Mobile')
  })

  it('neutralizes a name that a spreadsheet would run as a formula', () => {
    const named = [{ ...raw[2], profiles: { ...raw[2].profiles, display_name: '=HYPERLINK("http://x")' } }]
    const csv = buildContactCsv(groupGameInterestRows(named))
    const dataLine = csv.split('\n')[1]
    expect(dataLine.startsWith('=')).toBe(false)
    expect(dataLine.startsWith('"=')).toBe(false)
    expect(dataLine).toContain("'=HYPERLINK")
  })
})
