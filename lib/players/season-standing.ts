import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'

export interface SeasonStanding {
  seasonName: string | null
  rank: number | null
  points: number
  pointsAtRankSixteen: number
  monthlyRank: number | null
  monthlyPoints: number
}

type Admin = Parameters<typeof getSeasonLeaderboard>[0]

// The single implementation of a player's standing in the ACTIVE season — shared by the web profile page (hero pill +
// owner card) and GET /me/progress so the two can never disagree. Null when there is no active season.
// `getAdmin` is lazy: the service-role client is only constructed when there is an active season to read.
// Monthly figures are only computed when asked (`includeMonthly`): public visitors skip that query entirely.
export async function loadSeasonStanding(
  supabase: SupabaseClient<Database>,
  getAdmin: () => Admin,
  playerId: string,
  includeMonthly: boolean,
  now: Date = new Date(),
): Promise<SeasonStanding | null> {
  const { data: activeSeason } = await supabase.from('seasons').select('id, name').eq('status', 'active').maybeSingle()
  if (!activeSeason) return null

  // DLS-only for now, matching this card's pre-multi-game behavior — see
  // the equivalent note on app/[locale]/seasons/[slug]/page.tsx. Showing a
  // per-game season standing here is a separate follow-up.
  const seasonAdmin = getAdmin()
  const { data: dlsGame } = await supabase.from('games').select('id').eq('slug', 'dls').maybeSingle()
  const seasonBoard = await getSeasonLeaderboard(seasonAdmin, activeSeason.id, dlsGame?.id ?? '')
  const idx = seasonBoard.findIndex((r) => r.playerId === playerId)

  let monthlyRank: number | null = null
  let monthlyPoints = 0
  if (includeMonthly) {
    const monthlyBoard = await getMonthlyLeaderboard(seasonAdmin, activeSeason.id, now, dlsGame?.id ?? '')
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === playerId)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }

  return {
    seasonName: (activeSeason as { name?: string | null }).name ?? null,
    rank: idx >= 0 ? idx + 1 : null,
    points: idx >= 0 ? seasonBoard[idx].points : 0,
    pointsAtRankSixteen: seasonBoard[15]?.points ?? 0,
    monthlyRank,
    monthlyPoints,
  }
}
