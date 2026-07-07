export interface PublishableTournament {
  gameId: string | null
  maxPlayers: number | null
  registrationFee: number | null
  prizePool: number | null
  dates: (string | null)[]
}

// Human-readable labels for each required-to-publish field that is absent.
// Empty array means the tournament is ready to open for registration.
export function missingForPublish(t: PublishableTournament): string[] {
  const missing: string[] = []
  if (!t.gameId) missing.push('game')
  if (t.maxPlayers == null) missing.push('max players')
  if (t.registrationFee == null) missing.push('registration fee')
  if (t.prizePool == null) missing.push('prize pool')
  if (!t.dates.some((d) => d != null && d !== '')) missing.push('at least one scheduled date')
  return missing
}
