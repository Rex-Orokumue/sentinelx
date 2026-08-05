export type MembershipTier = 'recruit' | 'guardian' | 'elite' | 'sentinel' | 'legend'

export const TIER_XP_THRESHOLDS: Record<MembershipTier, number> = {
  recruit: 0,
  guardian: 1_000,
  elite: 5_000,
  sentinel: 15_000,
  legend: 50_000,
}

export function computeTier(xp: number): MembershipTier {
  if (xp >= TIER_XP_THRESHOLDS.legend) return 'legend'
  if (xp >= TIER_XP_THRESHOLDS.sentinel) return 'sentinel'
  if (xp >= TIER_XP_THRESHOLDS.elite) return 'elite'
  if (xp >= TIER_XP_THRESHOLDS.guardian) return 'guardian'
  return 'recruit'
}
