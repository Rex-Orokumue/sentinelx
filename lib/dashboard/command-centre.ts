import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian',
  guardian: 'elite',
  elite: 'sentinel',
  sentinel: 'legend',
  legend: null,
}
const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}

export function winRatePercent(wins: number, totalMatches: number): number {
  return totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0
}

// "620 XP to Elite" / "MAX — LEGEND" — hero XP bar label, spec §2 Section 1.
export function xpToNextTierLabel(xp: number): string {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  if (!next) return 'MAX — LEGEND'
  return `${(TIER_XP_THRESHOLDS[next] - xp).toLocaleString()} XP to ${TIER_LABEL[next]}`
}

// Login-streak coin-bonus preview shown one day ahead of a milestone —
// spec §2 Section 5: "+50 coins tomorrow" on day 6, "+200 coins tomorrow" on day 29.
// (Milestone reward days themselves — 7 and 30 — live in the login-streak reward
// logic; this only previews them a day early.)
export function streakMilestonePreview(currentStreak: number): string | null {
  const tomorrow = currentStreak + 1
  if (tomorrow === 7) return '+50 coins tomorrow'
  if (tomorrow === 30) return '+200 coins tomorrow'
  return null
}

// Season Standing card's qualification bar — spec §2 Section 4.
export function seasonQualifyProgress(
  rank: number | null,
  currentPoints: number,
  pointsOfRankSixteen: number,
): { qualified: boolean; pointsNeeded: number } {
  if (rank != null && rank <= 16) return { qualified: true, pointsNeeded: 0 }
  return { qualified: false, pointsNeeded: Math.max(0, pointsOfRankSixteen - currentPoints) }
}
