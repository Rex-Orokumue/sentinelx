// Turning paid registrations into the units that actually compete.
//
// A points-race tournament does not draw a bracket at registration close; it
// creates entrants. One per paid player for a solo tournament, one per
// completed squad for a squad tournament (phase 5).
//
// Pure so the de-duplication and name-fallback rules are testable without a
// database — both of which, if wrong, fail registration close for the whole
// tournament rather than for one player.

export interface EntrantSeed {
  playerId: string
  displayName: string
}

export interface SoloEntrantRow {
  tournament_id: string
  kind: 'solo'
  player_id: string
  display_name: string
  status: 'active'
}

export function soloEntrantRows(tournamentId: string, seeds: EntrantSeed[]): SoloEntrantRow[] {
  const seen = new Set<string>()
  const rows: SoloEntrantRow[] = []

  for (const s of seeds) {
    // UNIQUE (tournament_id, player_id) — one duplicate would abort the whole
    // insert, so drop it here rather than letting Postgres fail the batch.
    if (seen.has(s.playerId)) continue
    seen.add(s.playerId)
    rows.push({
      tournament_id: tournamentId,
      kind: 'solo',
      player_id: s.playerId,
      // display_name is NOT NULL and frozen at entry time; a nameless profile
      // must not break registration close.
      display_name: s.displayName.trim() || 'Player',
      status: 'active',
    })
  }

  return rows
}
