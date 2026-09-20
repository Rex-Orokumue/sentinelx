import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { fetchChampions, latestChampion } from '@/lib/tournaments/champions'
import type { HallOfFameTeaserData } from './hall-of-fame-teaser'

// The exact shape of the profiles select below — a superset of
// components/home/LeaderboardRow.tsx's own LeaderboardPlayer prop interface
// (which omits total_matches since the component doesn't render it, even
// though the query already selects it). A superset is assignable where that
// narrower prop type is expected, so the web page can still pass this
// straight into <LeaderboardRow player={...}>, while mapLeaderboardRow below
// (which the API layer needs) has the total_matches field it requires.
export interface LeaderboardPlayerRow {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  wins: number
  total_matches: number
  sx_score: number
  sentinel_tier: string | null
  membership_tier: string | null
  equipped_avatar_border: string | null
}

// The camelCase wire shape (GET /home's response, via mapLeaderboardRow below).
export interface LeaderboardPlayerSummary {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  wins: number
  totalMatches: number
  sxScore: number
  sentinelTier: string | null
  membershipTier: string | null
  equippedAvatarBorder: string | null
}

export interface HomeBanner {
  title: string
  imageUrl: string
  linkUrl: string
}

// buildHomeSummary() stays in each component's native snake_case shape,
// because the web page passes featuredTournament/upcomingTournaments and
// leaderboardTeaser straight into the existing <TournamentCard> and
// <LeaderboardRow> components, which are typed against those exact shapes.
// The API layer (lib/mobile-api/endpoints/home.ts) maps each one through
// mapTournamentCard()/mapLeaderboardRow() below for its camelCase wire
// response — raw internally, camelCase on the wire, consistently for both.
export interface HomeSummary {
  banner: HomeBanner | null
  featuredTournament: TournamentCardData | null
  upcomingTournaments: TournamentCardData[]
  leaderboardTeaser: LeaderboardPlayerRow[]
  hallOfFame: HallOfFameTeaserData | null
  stats: { playerCount: number; tournamentCount: number; prizesPaidOut: number }
}

export interface TournamentCardSummary {
  id: string
  title: string
  slug: string
  prizePool: number
  registrationFee: number
  status: string
  tournamentStart: string | null
  registrationEnd: string | null
  tournamentEnd: string | null
  maxPlayers: number | null
  format: string | null
  tournamentType: string | null
  cardImageUrl: string | null
  game: { name: string; iconUrl: string | null; slug: string | null; category: string | null } | null
}

export function mapTournamentCard(t: TournamentCardData): TournamentCardSummary {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    prizePool: t.prize_pool,
    registrationFee: t.registration_fee,
    status: t.status,
    tournamentStart: t.tournament_start,
    registrationEnd: t.registration_end,
    tournamentEnd: t.tournament_end ?? null,
    maxPlayers: t.max_players,
    format: t.format ?? null,
    tournamentType: t.tournament_type ?? null,
    cardImageUrl: t.card_image_url ?? null,
    game: t.games ? { name: t.games.name, iconUrl: t.games.icon_url, slug: t.games.slug ?? null, category: t.games.category ?? null } : null,
  }
}

// Ensures any 'active' tournament shows first as featured — matches the
// homepage's pre-existing sort exactly.
export function sortFeaturedFirst<T extends { status: string }>(tournaments: T[]): T[] {
  return [...tournaments].sort((a, b) =>
    a.status === 'active' && b.status !== 'active' ? -1
    : b.status === 'active' && a.status !== 'active' ? 1
    : 0,
  )
}

export function sumPrizePool(completed: { prize_pool: number | null }[] | null): number {
  return (completed ?? []).reduce((sum, t) => sum + (t.prize_pool ?? 0), 0)
}

export function mapBanner(raw: { title: string; image_url: string; link_url: string } | null): HomeBanner | null {
  return raw ? { title: raw.title, imageUrl: raw.image_url, linkUrl: raw.link_url } : null
}

export function mapLeaderboardRow(p: LeaderboardPlayerRow): LeaderboardPlayerSummary {
  return {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    wins: p.wins,
    totalMatches: p.total_matches,
    sxScore: p.sx_score,
    sentinelTier: p.sentinel_tier,
    membershipTier: p.membership_tier,
    equippedAvatarBorder: p.equipped_avatar_border,
  }
}

// Extracted from app/[locale]/page.tsx's data-fetching block — the page and
// GET /home both call this, so the numbers can never drift.
export async function buildHomeSummary(supabase: SupabaseClient<Database>): Promise<HomeSummary> {
  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: completedTournaments },
    { count: playerCount },
    { count: tournamentCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, card_image_url, games(name, icon_url, slug, category)',
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, wins, total_matches, sx_score, sentinel_tier, membership_tier, equipped_avatar_border')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
    supabase.from('homepage_banners').select('title, image_url, link_url').eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
  ])

  const latest = latestChampion(await fetchChampions(supabase))
  const hallOfFame: HallOfFameTeaserData | null = latest
    ? { slug: latest.slug, title: latest.title, prizePool: latest.prizePool ?? 0, gameName: latest.gameName || null, championName: latest.champion.name }
    : null

  const tournaments = sortFeaturedFirst((rawTournaments ?? []) as TournamentCardData[])

  return {
    banner: mapBanner(rawBanner ?? null),
    featuredTournament: tournaments[0] ?? null,
    upcomingTournaments: tournaments.slice(1),
    leaderboardTeaser: players ?? [],
    hallOfFame,
    stats: { playerCount: playerCount ?? 0, tournamentCount: tournamentCount ?? 0, prizesPaidOut: sumPrizePool(completedTournaments) },
  }
}
