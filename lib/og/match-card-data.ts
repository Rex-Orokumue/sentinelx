import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { formatFixtureDate } from '@/lib/format'

export type CardPlayer = {
  displayName: string | null
  username: string | null
  avatarUrl: string | null
}

export type HypeCardInput = {
  variant: 'hype'
  tournamentTitle: string
  playerA: CardPlayer
  playerB: CardPlayer
  scheduledLabel: string | null
}

export type ResultCardInput = {
  variant: 'result'
  tournamentTitle: string
  playerA: CardPlayer
  playerB: CardPlayer
  scoreA: number
  scoreB: number
  winnerSide: 'player_a' | 'player_b' | null
}

// Anything not yet completed shows the hype layout — including live, disputed,
// cancelled, forfeited, and bye. There's no result worth showing yet for any
// of those, and erroring would break the existing passive OG-image use case
// those statuses already rely on today.
export function selectCardVariant(status: string): 'hype' | 'result' {
  return status === 'completed' ? 'result' : 'hype'
}

export function resultWinnerSide(scoreA: number | null, scoreB: number | null): 'player_a' | 'player_b' | null {
  if (scoreA == null || scoreB == null || scoreA === scoreB) return null
  return scoreA > scoreB ? 'player_a' : 'player_b'
}

type ProfileRef = { username: string | null; display_name: string | null; avatar_url: string | null }
type Ref<T> = T | T[] | null
function firstOf<T>(x: Ref<T>): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}
function toCardPlayer(p: Ref<ProfileRef>): CardPlayer {
  const r = firstOf(p)
  return { displayName: r?.display_name ?? null, username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
}

export async function loadMatchCardInput(
  supabase: SupabaseClient<Database>,
  matchId: string,
): Promise<HypeCardInput | ResultCardInput | null> {
  const { data: raw } = await supabase
    .from('matches')
    .select(
      'status, score_a, score_b, scheduled_at, is_full_day, ' +
        'tournaments(title), ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url)',
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!raw) return null
  const m = raw as unknown as {
    status: string
    score_a: number | null
    score_b: number | null
    scheduled_at: string | null
    is_full_day: boolean
    tournaments: Ref<{ title: string }>
    player_a: Ref<ProfileRef>
    player_b: Ref<ProfileRef>
  }

  const playerA = toCardPlayer(m.player_a)
  const playerB = toCardPlayer(m.player_b)
  const tournamentTitle = firstOf(m.tournaments)?.title ?? 'Sentinel X'

  if (selectCardVariant(m.status) === 'result') {
    return {
      variant: 'result',
      tournamentTitle,
      playerA,
      playerB,
      scoreA: m.score_a ?? 0,
      scoreB: m.score_b ?? 0,
      winnerSide: resultWinnerSide(m.score_a, m.score_b),
    }
  }
  return {
    variant: 'hype',
    tournamentTitle,
    playerA,
    playerB,
    scheduledLabel: formatFixtureDate(m.scheduled_at, m.is_full_day),
  }
}
