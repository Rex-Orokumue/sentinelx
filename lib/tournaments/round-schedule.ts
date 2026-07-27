import { fromDateLocal } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Pure: add N calendar days to a UTC instant. Safe without timezone
// conversion because WAT (Africa/Lagos, UTC+1) has no DST — same reasoning
// migration 021 (full-day matches) already relies on.
export function addRoundGapDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}

// Pure: the scheduled_at (a UTC instant representing midnight WAT) for a
// round about to be generated, given how many rounds already exist for this
// tournament. roundsGenerated=0 means this is the first round, so it lands
// exactly on roundStartDate itself.
export function computeNextRoundDate(
  roundStartDate: string,
  roundGapDays: number,
  roundsGenerated: number,
): string {
  const base = fromDateLocal(roundStartDate)
  if (!base) throw new Error(`Invalid round_start_date: ${roundStartDate}`)
  return addRoundGapDays(base, roundsGenerated * roundGapDays)
}

// The scheduled_at for the next round of matches about to be generated for
// this tournament, or null if auto-scheduling is off (round_start_date
// unset — admin schedules each match manually, unchanged from before this
// feature).
//
// Deliberately does NOT read any match's scheduled_at (a manually-edited
// match could otherwise skew a MAX()-based calculation). Instead it counts
// distinct `round` values already present — every round is inserted as a
// single atomic batch (recomputeGroupAndMaybeAdvance/advanceKnockout both
// refuse to insert into a round that already has rows — see
// lib/matches/verify-actions.ts), so that count is exactly how many
// round-dates have already been assigned.
export async function nextRoundScheduledAt(
  admin: Admin,
  tournamentId: string,
): Promise<string | null> {
  const { data: t } = await admin
    .from('tournaments')
    .select('round_start_date, round_gap_days')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t?.round_start_date) return null

  const { data: rows } = await admin
    .from('matches')
    .select('round')
    .eq('tournament_id', tournamentId)
  const roundsGenerated = new Set((rows ?? []).map((r) => r.round)).size

  return computeNextRoundDate(t.round_start_date, t.round_gap_days, roundsGenerated)
}
