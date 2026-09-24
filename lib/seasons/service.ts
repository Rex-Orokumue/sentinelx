import type { SupabaseClient } from '@supabase/supabase-js'
import type { createAdminClient } from '@/lib/supabase/admin'
import { seasonTierLabelsFor, type SeasonTierLabels } from '@/lib/games/season-tier-labels'
import { getSeasonLeaderboard, type SeasonLeaderboardRow } from './data'

type Admin = ReturnType<typeof createAdminClient>

export interface SeasonSummary {
  id: string
  slug: string
  name: string
  start_date: string
  end_date: string
}

export interface SeasonTournamentRow {
  id: string
  title: string
  slug: string
  tournament_type: string
  status: string
  tournament_start: string | null
  invitation_only: boolean
}

export interface SeasonGameSectionData {
  gameId: string
  gameName: string
  tournaments: SeasonTournamentRow[]
  leaderboard: SeasonLeaderboardRow[]
  tierLabels: SeasonTierLabels
}

export async function listSeasons(supabase: SupabaseClient): Promise<SeasonSummary[]> {
  const { data } = await supabase
    .from('seasons')
    .select('id, slug, name, start_date, end_date')
    .order('start_date', { ascending: false })
  return (data ?? []) as SeasonSummary[]
}

export async function getSeasonBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<(SeasonSummary & Record<string, unknown>) | null> {
  const { data } = await supabase.from('seasons').select('*').eq('slug', slug).maybeSingle()
  return data as (SeasonSummary & Record<string, unknown>) | null
}

export async function getSeasonSections(
  supabase: SupabaseClient,
  admin: Admin,
  seasonId: string,
): Promise<SeasonGameSectionData[]> {
  const { data: activeGamesRaw } = await supabase.from('games').select('id, name, slug').eq('active', true)
  const activeGames = (activeGamesRaw ?? []).sort((a, b) =>
    a.slug === 'dls' ? -1 : b.slug === 'dls' ? 1 : a.name.localeCompare(b.name),
  )

  return Promise.all(
    activeGames.map(async (game) => {
      const [{ data: tournaments }, leaderboard] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, slug, tournament_type, status, tournament_start, invitation_only')
          .eq('season_id', seasonId)
          .eq('game_id', game.id)
          .neq('tournament_type', 'open')
          .order('tournament_start'),
        getSeasonLeaderboard(admin, seasonId, game.id),
      ])
      return {
        gameId: game.id,
        gameName: game.name,
        tournaments: (tournaments ?? []) as SeasonTournamentRow[],
        leaderboard,
        tierLabels: seasonTierLabelsFor(game.slug),
      }
    }),
  )
}
