// Pure derivation of onboarding-quest progress. Kept side-effect-free so it
// is directly unit-testable without mocking Supabase — the caller
// (lib/guide/actions.ts) does the DB reads and passes in plain booleans/a
// count. See docs/superpowers/specs/2026-08-18-guide-system-design.md
// "Data: quest-status computation" for why this is 3 steps, not 4 —
// `profiles.total_matches` only increments after admin confirmation, so
// "played" and "submitted its result" are the same observable signal.
export interface QuestStatusInput {
  hasUsername: boolean
  hasAvatar: boolean
  hasPaidRegistration: boolean
  totalMatches: number
}

export interface QuestStatus {
  profileComplete: boolean
  firstTournamentEntered: boolean
  firstMatchCompleted: boolean
  allComplete: boolean
}

export function computeQuestStatus(input: QuestStatusInput): QuestStatus {
  const profileComplete = input.hasUsername && input.hasAvatar
  const firstTournamentEntered = input.hasPaidRegistration
  const firstMatchCompleted = input.totalMatches >= 1
  return {
    profileComplete,
    firstTournamentEntered,
    firstMatchCompleted,
    allComplete: profileComplete && firstTournamentEntered && firstMatchCompleted,
  }
}
