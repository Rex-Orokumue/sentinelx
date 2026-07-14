import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'
import { matchOutcome, type ProfileView, type ProfileMatch, type ProfileTitle } from '@/lib/players/profile'
import { friendshipStatus, type FriendshipStatus } from '@/lib/friends/list'
import { scoreStatsByPlayerAndCategory, type GameScopedMatch, type CategoryStat } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import { ProfileHeader } from '@/components/player/ProfileHeader'
import { ProfileStats } from '@/components/player/ProfileStats'
import { ProfileAchievements } from '@/components/player/ProfileAchievements'
import { ProfileMatchHistory } from '@/components/player/ProfileMatchHistory'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
const PROFILE_COLS =
  'id, username, display_name, avatar_url, country, bio, created_at, sentinel_score, sentinel_tier, ' +
  'total_matches, wins, losses, goals_scored, goals_conceded, total_titles'

type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  country: string | null
  bio: string | null
  created_at: string | null
  sentinel_score: number
  sentinel_tier: string | null
  total_matches: number
  wins: number
  losses: number
  goals_scored: number
  goals_conceded: number
  total_titles: number
}

type NameRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function firstName(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'TBD'
}

type GameRef = { name: string } | { name: string }[] | null
function gameName(g: GameRef): string | null {
  const r = Array.isArray(g) ? g[0] ?? null : g
  return r?.name ?? null
}

type TitleTournamentRef =
  | { title: string; slug: string; tournament_end: string | null; game: GameRef }
  | { title: string; slug: string; tournament_end: string | null; game: GameRef }[]
  | null
function firstTitleTournament(x: TitleTournamentRef) {
  return Array.isArray(x) ? x[0] ?? null : x
}

type TitleRef = { title: string } | { title: string }[] | null
function firstTitleName(x: TitleRef): string | null {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? null
}

type CategoryGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type CategoryTournamentRef = { game: CategoryGameRef } | { game: CategoryGameRef }[] | null
function firstCategoryGameRef(g: CategoryGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstCategoryTournamentRef(t: CategoryTournamentRef): { game: CategoryGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

// Explicit row shapes for the embedded selects below — the Supabase type-level
// select parser can't resolve these multi-embed joins and falls back to an error
// type, so we cast the (runtime-correct) results to these.
type RecentRow = {
  id: string
  score_a: number | null
  score_b: number | null
  completed_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  tournament: TitleRef
  player_a: NameRef
  player_b: NameRef
}
type FinalRow = {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
  tournament: TitleTournamentRef
}

async function loadProfile(username: string): Promise<ProfileRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('profiles').select(PROFILE_COLS).eq('username', username).maybeSingle()
  return (data as ProfileRow | null) ?? null
}

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const p = await loadProfile(params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  const title = `${name} (@${p.username}) — SentinelX Esports`
  const description = `Sentinel Score ${p.sentinel_score} · ${p.wins}W–${p.losses}L · ${p.total_titles} titles on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/players/${p.username}`,
      siteName: 'SentinelX Esports',
      type: 'profile',
    },
  }
}

function toBracketFinal(f: {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}): BracketMatch {
  return {
    id: '',
    round: f.round,
    group_id: null,
    groupName: null,
    status: f.status,
    score_a: f.score_a,
    score_b: f.score_b,
    scheduled_at: null,
    playerA: { id: f.player_a_id ?? '', name: '' },
    playerB: { id: f.player_b_id ?? '', name: '' },
  }
}

export default async function PlayerProfilePage({ params }: { params: { username: string } }) {
  const supabase = createClient()
  const p = await loadProfile(params.username)
  if (!p) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let friendship: FriendshipStatus = 'none'
  if (user && user.id !== p.id) {
    const { data: friendRow } = await supabase
      .from('friends')
      .select('requester_id, recipient_id, status')
      .or(`and(requester_id.eq.${user.id},recipient_id.eq.${p.id}),and(requester_id.eq.${p.id},recipient_id.eq.${user.id})`)
      .maybeSingle()
    if (friendRow) {
      friendship = friendshipStatus(
        [{ requesterId: friendRow.requester_id, recipientId: friendRow.recipient_id, status: friendRow.status }],
        user.id,
        p.id,
      )
    }
  }

  const [{ data: rankData }, { data: rawMatches }, { data: rawFinals }, { data: rawCategoryMatches }] = await Promise.all([
    supabase.rpc('player_rank', { uname: p.username }),
    supabase
      .from('matches')
      .select(
        'id, score_a, score_b, completed_at, player_a_id, player_b_id, ' +
          'tournament:tournaments(title), ' +
          'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
      )
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`)
      .order('completed_at', { ascending: false })
      .limit(10),
    supabase
      .from('matches')
      .select(
        'round, status, score_a, score_b, player_a_id, player_b_id, ' +
          'tournament:tournaments(title, slug, tournament_end, game:games(name))',
      )
      .eq('round', 'final')
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`),
    supabase
      .from('matches')
      .select(
        'score_a, score_b, player_a_id, player_b_id, status, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed')
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`),
  ])

  const categoryMatches: GameScopedMatch[] = ((rawCategoryMatches as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      score_a: number | null
      score_b: number | null
      player_a_id: string | null
      player_b_id: string | null
      status: string
      tournament: CategoryTournamentRef
    }
    const t = firstCategoryTournamentRef(m.tournament)
    const g = firstCategoryGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const categoryStats: CategoryStat[] = Object.keys(CATEGORY_META).map((category) => {
    const stat = scoreStatsByPlayerAndCategory(categoryMatches, category).get(p.id) ?? { scored: 0, conceded: 0 }
    return { category, ...stat }
  })

  const profile: ProfileView = {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    country: p.country,
    bio: p.bio,
    createdAt: p.created_at,
    sentinelScore: p.sentinel_score,
    sentinelTier: p.sentinel_tier,
    totalMatches: p.total_matches,
    wins: p.wins,
    losses: p.losses,
    goalsScored: p.goals_scored,
    goalsConceded: p.goals_conceded,
    totalTitles: p.total_titles,
    categoryStats,
    rank: (rankData as number | null) ?? null,
  }

  const recentRows = (rawMatches ?? []) as unknown as RecentRow[]
  const matches: ProfileMatch[] = recentRows
    .filter((m) => m.player_a_id && m.player_b_id && m.score_a != null && m.score_b != null)
    .map((m) => {
      const isA = m.player_a_id === p.id
      return {
        id: m.id,
        opponentName: firstName(isA ? m.player_b : m.player_a),
        playerScore: (isA ? m.score_a : m.score_b) as number,
        opponentScore: (isA ? m.score_b : m.score_a) as number,
        outcome: matchOutcome(p.id, {
          player_a_id: m.player_a_id as string,
          player_b_id: m.player_b_id as string,
          score_a: m.score_a as number,
          score_b: m.score_b as number,
        }),
        tournamentTitle: firstTitleName(m.tournament),
        completedAt: m.completed_at,
      }
    })

  const finalRows = (rawFinals ?? []) as unknown as FinalRow[]
  const titles: ProfileTitle[] = finalRows
    .filter((f) => getChampion([toBracketFinal(f)])?.id === p.id)
    .map((f) => {
      const t = firstTitleTournament(f.tournament)
      return {
        tournamentTitle: t?.title ?? 'Tournament',
        tournamentSlug: t?.slug ?? '',
        gameName: gameName(t?.game ?? null),
        date: t?.tournament_end ?? null,
      }
    })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: p.display_name ?? p.username,
      alternateName: p.username,
      url: `${SITE_URL}/players/${p.username}`,
    },
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProfileHeader profile={profile} viewerId={user?.id ?? null} friendshipStatus={friendship} />
      <ProfileStats profile={profile} />
      <ProfileAchievements titles={titles} />
      <ProfileMatchHistory matches={matches} />
    </div>
  )
}
