// Legacy naira rate — no longer awarded for new referrals. Kept only
// because historical wallet_transactions rows predate this redesign.
export const REFERRAL_CREDIT_NGN = 100

// New coin economy (Phase 3 redesign) — see
// docs/superpowers/specs/2026-08-16-referral-system-design.md §5.
export const REFERRAL_BASE_REWARD_COINS = 250

export interface ReferralMilestone {
  count: number
  achievementSlug: string
}

export const REFERRAL_MILESTONES: ReferralMilestone[] = [
  { count: 1, achievementSlug: 'referral_first' },
  { count: 5, achievementSlug: 'referral_squad' },
  { count: 10, achievementSlug: 'referral_champion' },
  { count: 25, achievementSlug: 'referral_sentinel' },
  { count: 50, achievementSlug: 'referral_legend' },
]

// Pure — which milestone (if any) does this converted-referral count exactly
// hit? Called once per settlement, right after the count increments by one,
// so an exact-match lookup (not >=) is correct and never re-fires a
// milestone already passed.
export function pickMilestone(convertedCount: number): ReferralMilestone | null {
  return REFERRAL_MILESTONES.find((m) => m.count === convertedCount) ?? null
}
