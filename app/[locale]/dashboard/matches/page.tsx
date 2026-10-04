import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bucketFixtures, isTournamentPublished, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { ActiveFixtures, CompletedFixtures } from '@/components/dashboard/FixtureCard'
import { TournamentStatusBanners } from '@/components/dashboard/TournamentStatusBanner'
import { DataSupportPanel } from '@/components/dashboard/DataSupportPanel'
import {
  computeTournamentStatus,
  type KnockoutMatchInput,
  type TournamentBanner,
} from '@/lib/dashboard/tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'
import { computeDataSupportEligibility } from '@/lib/dashboard/data-support'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import {
  MATCH_SIDES_SELECT,
  getMySquadIds,
  isMySide,
  mySideId,
  myMatchesFilter,
  pickOpponent,
  type SquadRef,
} from '@/lib/matches/sides'

export const metadata: Metadata = { title: 'My Matches · SentinelX Esports', robots: { index: false, follow: false } }

type ProfileRef = { id?: string; username: string | null; display_name: string | null; country?: string | null } | null
type TournamentRef =
  | { title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null }
  | { title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null }[]
  | null

function countryOf(p: ProfileRef): string | null {
  return p?.country ?? null
}
function firstTournament(t: TournamentRef): {
  title: string; slug: string; status: string; data_support_text: string | null; data_support_whatsapp: string | null
} | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}

export default async function DashboardMatchesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/matches')

  // Squad matches have no player ids on them, so "my matches" needs the squads
  // I'm on as well as my own id.
  const squadIds = await getMySquadIds(supabase, user.id)

  const [profileRes, matchesRes, resultsRes, myGroupMembershipsRes] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, team_a_id, team_b_id, score_a, score_b, ' +
          MATCH_SIDES_SELECT +
          ', tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
      .or(myMatchesFilter(user.id, squadIds)),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    // A squad's group membership is keyed by team_id, not player_id.
    supabase
      .from('group_memberships')
      .select('group_id, player_id, team_id, groups(tournament_id)')
      .or(
        squadIds.length > 0
          ? `player_id.eq.${user.id},team_id.in.(${squadIds.join(',')})`
          : `player_id.eq.${user.id}`,
      ),
  ])

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string; status: string; scheduled_at: string | null; is_full_day: boolean; round: string
    tournament_id: string; player_a_id: string | null; player_b_id: string | null
    team_a_id: string | null; team_b_id: string | null; score_a: number | null; score_b: number | null
    player_a: ProfileRef; player_b: ProfileRef; team_a: SquadRef; team_b: SquadRef; tournament: TournamentRef
  }[]

  // A bracket generated at registration close (status 'registration_closed') is a
  // staff-only preview until admin publishes it — hide those fixtures from the player
  // dashboard the same way the public bracket page hides them from the public.
  const visibleMatches = rawMatches.filter((mm) => isTournamentPublished(firstTournament(mm.tournament)?.status))

  // Opponent WhatsApp numbers are per-tournament registration data, not
  // profile data. tournament_registrations RLS only lets a player read their
  // OWN row (auth.uid() = player_id) — an opponent's number is invisible to
  // the regular client, so this narrow lookup uses the service-role client,
  // scoped to exactly the opponents in this player's own visible matches
  // (never a blanket read of every registration).
  const matchTournamentIds = Array.from(new Set(visibleMatches.map((mm) => mm.tournament_id)))
  // A squad opponent's contact is its captain (a squad has no number of its own).
  const opponentIds = Array.from(
    new Set(
      visibleMatches
        .map((mm) => pickOpponent(mm, user.id, squadIds).contactPlayerId)
        .filter((id): id is string => id != null),
    ),
  )
  const { data: regRows } =
    matchTournamentIds.length > 0 && opponentIds.length > 0
      ? await createAdminClient()
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_whatsapp')
          .in('tournament_id', matchTournamentIds)
          .in('player_id', opponentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_whatsapp: string | null }[] }
  const whatsappByKey = new Map((regRows ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_whatsapp]))

  const matches: DashboardMatchInput[] = visibleMatches.map((mm) => {
    const opponent = pickOpponent(mm, user.id, squadIds)
    const opponentProfile = isMySide(mm, user.id, squadIds) === 'b' ? mm.player_a : mm.player_b
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      isFullDay: mm.is_full_day,
      round: mm.round,
      opponentName: opponent.name,
      opponentWhatsapp: opponent.contactPlayerId
        ? whatsappByKey.get(`${mm.tournament_id}:${opponent.contactPlayerId}`) ?? null
        : null,
      opponentCountry: countryOf(opponentProfile),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())

  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  function firstGroupTournamentId(g: GroupTournamentRef): string | null {
    const row = Array.isArray(g) ? g[0] ?? null : g
    return row?.tournament_id ?? null
  }

  const myGroupRows = ((myGroupMembershipsRes.data as unknown[] | null) ?? []) as {
    group_id: string; player_id: string | null; team_id: string | null; groups: GroupTournamentRef
  }[]
  const groupIdByTournamentId = new Map<string, string>()
  // The id that stands for this user in a tournament's results: their squad id
  // in a team tournament, their own id in a solo one.
  const competitorIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const tId = firstGroupTournamentId(r.groups)
    if (tId) {
      groupIdByTournamentId.set(tId, r.group_id)
      competitorIdByTournamentId.set(tId, r.team_id ?? r.player_id ?? user.id)
    }
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase
            .from('group_memberships')
            .select('group_id, player_id, team_id, wins, draws, losses, goals_for, goals_against, points')
            .in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [
          { data: [] as { group_id: string; player_id: string | null; team_id: string | null; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; points: number }[] },
          { data: [] as { group_id: string; status: string }[] },
        ]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId && (r.player_id ?? r.team_id) != null)
        .map((r) => ({
          playerId: (r.player_id ?? r.team_id) as string, name: '', wins: r.wins, draws: r.draws, losses: r.losses,
          goalsFor: r.goals_for, goalsAgainst: r.goals_against, points: r.points,
        })),
    )
  }

  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  for (const mm of visibleMatches) {
    if (mm.round === 'group') continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({
      round: mm.round, status: mm.status, score_a: mm.score_a, score_b: mm.score_b,
      player_a_id: mm.player_a_id, player_b_id: mm.player_b_id,
      team_a_id: mm.team_a_id, team_b_id: mm.team_b_id,
    })
    const mine = mySideId(mm, user.id, squadIds)
    if (mine && !competitorIdByTournamentId.has(mm.tournament_id)) {
      competitorIdByTournamentId.set(mm.tournament_id, mine)
    }
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  // Built from rawMatches (not visibleMatches) so an unpublished tournament's
  // title/status is still resolvable here — but such a tournament is then
  // deliberately skipped below via isTournamentPublished, same privacy rule
  // the rest of this page already applies to fixtures.
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of rawMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, { title: t.title, slug: t.slug, status: t.status })
  }

  const tournamentIdsToEvaluate = Array.from(
    new Set<string>([...Array.from(knockoutMatchesByTournament.keys()), ...Array.from(groupIdByTournamentId.keys())]),
  )

  const tournamentBanners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(competitorIdByTournamentId.get(tournamentId) ?? user.id, {
      tournamentId, tournamentTitle: ref.title, tournamentSlug: ref.slug, tournamentStatus: ref.status,
      groupId, groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) tournamentBanners.push(banner)
  }

  const dataSupportEligibility = computeDataSupportEligibility(
    visibleMatches.map((mm) => {
      const t = firstTournament(mm.tournament)
      return {
        round: mm.round, tournamentId: mm.tournament_id, tournamentTitle: t?.title ?? 'Tournament',
        dataSupportText: t?.data_support_text ?? null, dataSupportWhatsapp: t?.data_support_whatsapp ?? null,
      }
    }),
  )

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">My Matches</h1>

      {dataSupportEligibility.length > 0 && (
        <DataSupportPanel username={profileRes.data?.username ?? ''} eligibility={dataSupportEligibility} />
      )}

      <section id="guide-target-matches">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Active</h2>
        <TournamentStatusBanners banners={tournamentBanners} />
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Completed</h2>
        <CompletedFixtures fixtures={fixtures.completed} />
      </section>
    </DashboardShell>
  )
}
