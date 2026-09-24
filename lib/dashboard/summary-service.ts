import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { bucketFixtures, isTournamentPublished, type DashboardMatchInput } from './fixtures'
import { fetchNextLobby } from '@/lib/tournaments/next-lobby'
import type { NextLobbyData } from '@/components/dashboard/NextLobbyCard'
import { computeTournamentStatus, type KnockoutMatchInput, type TournamentBanner } from './tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'

export interface MeSummaryNextMatch {
  id: string; status: string; round: string; scheduledAt: string | null; isFullDay: boolean; tournamentTitle: string
}
export interface MeSummaryRegistration {
  id: string; paymentStatus: string; tournamentTitle: string; tournamentSlug: string
}
export interface MeSummary {
  nextMatch: MeSummaryNextMatch | null
  nextLobby: NextLobbyData | null
  hasSubmittableMatch: boolean
  registrations: MeSummaryRegistration[]
  banners: NonNullable<TournamentBanner>[]
}

type TournamentRef = { title: string; slug: string; status: string } | { title: string; slug: string; status: string }[] | null
function firstTournament(t: TournamentRef) {
  return Array.isArray(t) ? t[0] ?? null : t
}

export async function buildMeSummary(supabase: SupabaseClient<Database>, userId: string): Promise<MeSummary> {
  const [nextMatchRes, resultsRes, openMatchesRes, registrationsRes, groupMembershipsRes, visibleMatchesRes, nextLobby] =
    await Promise.all([
      supabase
        .from('matches')
        .select('id, status, round, scheduled_at, is_full_day, tournament:tournaments(title), opponent_a:profiles!matches_player_a_id_fkey(id), opponent_b:profiles!matches_player_b_id_fkey(id)')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1),
      supabase.from('match_results').select('match_id').eq('submitted_by', userId),
      supabase
        .from('matches')
        .select('id, status, scheduled_at')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
        .in('status', ['scheduled', 'live']),
      supabase
        .from('tournament_registrations')
        .select('id, payment_status, tournament:tournaments(title, slug, status)')
        .eq('player_id', userId)
        .order('registered_at', { ascending: false }),
      supabase.from('group_memberships').select('group_id, groups(tournament_id)').eq('player_id', userId),
      supabase
        .from('matches')
        .select('id, round, status, score_a, score_b, tournament_id, player_a_id, player_b_id, tournament:tournaments(title, slug, status)')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`),
      fetchNextLobby(userId),
    ])

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const nextRaw = (nextMatchRes.data as unknown[] | null)?.[0] as
    | { id: string; status: string; round: string; scheduled_at: string | null; is_full_day: boolean; tournament: TournamentRef }
    | undefined
  const nextMatch: MeSummaryNextMatch | null = nextRaw
    ? {
        id: nextRaw.id, status: nextRaw.status, round: nextRaw.round, scheduledAt: nextRaw.scheduled_at,
        isFullDay: nextRaw.is_full_day, tournamentTitle: firstTournament(nextRaw.tournament)?.title ?? 'Tournament',
      }
    : null

  const openMatches: DashboardMatchInput[] = (openMatchesRes.data ?? []).map((m) => ({
    id: m.id, status: m.status, scheduledAt: m.scheduled_at, isFullDay: false, round: '',
    opponentName: '', tournamentTitle: '', tournamentSlug: '',
  }))
  const openFixtures = bucketFixtures(openMatches, submittedMatchIds, new Date())
  const hasSubmittableMatch = openFixtures.live.length > 0 || openFixtures.upcoming.some((f) => f.awaitingMyResult)

  const registrations: MeSummaryRegistration[] = ((registrationsRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return { id: r.id, paymentStatus: r.payment_status, tournamentTitle: t?.title ?? 'Tournament', tournamentSlug: t?.slug ?? '' }
  })

  // Qualify/eliminate banners — condensed from dashboard/matches/page.tsx's
  // group-membership + knockout-match composition.
  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  const myGroupRows = ((groupMembershipsRes.data as unknown[] | null) ?? []) as { group_id: string; groups: GroupTournamentRef }[]
  const groupIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const row = Array.isArray(r.groups) ? r.groups[0] ?? null : r.groups
    if (row?.tournament_id) groupIdByTournamentId.set(row.tournament_id, r.group_id)
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase.from('group_memberships').select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points').in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [{ data: [] as { group_id: string; player_id: string | null; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; points: number }[] }, { data: [] as { group_id: string; status: string }[] }]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId && r.player_id != null)
        .map((r) => ({ playerId: r.player_id as string, name: '', wins: r.wins, draws: r.draws, losses: r.losses, goalsFor: r.goals_for, goalsAgainst: r.goals_against, points: r.points })),
    )
  }

  type VisibleMatchRow = { id: string; round: string; status: string; score_a: number | null; score_b: number | null; tournament_id: string; player_a_id: string | null; player_b_id: string | null; tournament: TournamentRef }
  const visibleMatches = ((visibleMatchesRes.data as unknown[] | null) ?? []) as VisibleMatchRow[]
  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of visibleMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, t)
    if (mm.round === 'group' || !t || !isTournamentPublished(t.status)) continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({ round: mm.round, status: mm.status, score_a: mm.score_a, score_b: mm.score_b, player_a_id: mm.player_a_id, player_b_id: mm.player_b_id })
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  const tournamentIdsToEvaluate = Array.from(
    new Set<string>([...Array.from(knockoutMatchesByTournament.keys()), ...Array.from(groupIdByTournamentId.keys())]),
  )
  const banners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(userId, {
      tournamentId, tournamentTitle: ref.title, tournamentSlug: ref.slug, tournamentStatus: ref.status,
      groupId, groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) banners.push(banner)
  }

  return { nextMatch, nextLobby, hasSubmittableMatch, registrations, banners }
}
