// States a match's check-in can be in, from the admin's point of view when
// deciding a no-show.
export type CheckInVerdict = 'both' | 'one' | 'none'

export interface CheckInState {
  playerACheckedIn: boolean
  playerBCheckedIn: boolean
}

// Checking in is only meaningful once the match day has arrived and while the
// match is still open — there is nothing to be present for before that, and
// nothing to prove once a result is in.
export function canCheckIn(args: {
  isParticipant: boolean
  dayReached: boolean
  status: string
  alreadyCheckedIn: boolean
}): boolean {
  if (!args.isParticipant) return false
  if (args.alreadyCheckedIn) return false
  if (!args.dayReached) return false
  return args.status === 'scheduled' || args.status === 'live'
}

// What the check-ins say about who turned up. Deliberately just a reading of
// the evidence — it never decides the match. 'one' is the case the whole
// feature exists for: someone showed up and their opponent didn't.
export function checkInVerdict(state: CheckInState): CheckInVerdict {
  if (state.playerACheckedIn && state.playerBCheckedIn) return 'both'
  if (state.playerACheckedIn || state.playerBCheckedIn) return 'one'
  return 'none'
}

// The player who checked in when their opponent didn't — the one an admin
// would normally award a walkover to. Null unless exactly one checked in.
export function soleAttendee(
  state: CheckInState,
  playerAId: string | null,
  playerBId: string | null,
): string | null {
  if (checkInVerdict(state) !== 'one') return null
  return state.playerACheckedIn ? playerAId : playerBId
}

// Admin-facing sentence for the 'both'/'none' verdicts. Squad sides (non-null)
// get squad wording plus per-roster counts, since one present teammate is enough
// for a side to count as checked in but isn't the whole squad.
type SummarySide = { name: string; roster: { checkedIn: boolean }[] }
export function checkInSummary(verdict: 'both' | 'none', sideA: SummarySide | null, sideB: SummarySide | null): string {
  if (!sideA || !sideB) return verdict === 'both' ? 'Both players checked in.' : 'Neither player checked in.'
  if (verdict === 'none') return 'Neither squad checked in.'
  const count = (s: SummarySide) => `${s.name} ${s.roster.filter((r) => r.checkedIn).length} of ${s.roster.length}`
  return `Both squads have players checked in — ${count(sideA)}, ${count(sideB)}.`
}
