import type { MembershipTier } from '@/lib/membership/tiers'

export type HexAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

// Avatar hex diameter (width) in px per size key — spec §4.
export const SIZE_PX: Record<HexAvatarSize, number> = {
  xs: 28,
  sm: 40,
  md: 56,
  lg: 80,
  xl: 112,
}

// Tier frame border width in px — spec §2.
export const BORDER_WIDTH_PX: Record<MembershipTier, number> = {
  recruit: 2,
  guardian: 3,
  elite: 3,
  sentinel: 4,
  legend: 4,
}

// Height of a flat-top regular hexagon = width * (√3/2).
export function hexHeight(widthPx: number): number {
  return widthPx * 0.866
}
