// Achievement decoration badges layered on a HexAvatar's frame — spec §3.
// A player can show at most one badge per slot (top-right / bottom-right).

export type DecorationSlot = 'topRight' | 'bottomRight'

export interface AchievementDecoration {
  slug: string
  emoji: string
  colourClass: string // Tailwind background classes for the badge circle
  slot: DecorationSlot
}

// Ordered highest-priority-first within each slot — spec §3.
const TOP_RIGHT_PRIORITY: AchievementDecoration[] = [
  { slug: 'champions_cup_champion', emoji: '💎', colourClass: 'bg-gradient-to-br from-cyan-400 to-amber-400', slot: 'topRight' },
  { slug: 'masters_champion', emoji: '⭐', colourClass: 'bg-amber-500', slot: 'topRight' },
  { slug: 'champion_3x', emoji: '🔥', colourClass: 'bg-gradient-to-br from-orange-500 to-amber-400', slot: 'topRight' },
  { slug: 'first_champion', emoji: '👑', colourClass: 'bg-amber-500', slot: 'topRight' },
]
const BOTTOM_RIGHT_PRIORITY: AchievementDecoration[] = [
  { slug: 'win_streak_5', emoji: '⚡', colourClass: 'bg-sx-purple', slot: 'bottomRight' },
  { slug: 'matches_100', emoji: '🛡', colourClass: 'bg-slate-500', slot: 'bottomRight' },
]

export function resolveDecorations(slugs: string[]): {
  topRight: AchievementDecoration | null
  bottomRight: AchievementDecoration | null
} {
  const unlocked = new Set(slugs)
  return {
    topRight: TOP_RIGHT_PRIORITY.find((d) => unlocked.has(d.slug)) ?? null,
    bottomRight: BOTTOM_RIGHT_PRIORITY.find((d) => unlocked.has(d.slug)) ?? null,
  }
}
