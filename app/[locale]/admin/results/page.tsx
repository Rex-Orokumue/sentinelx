import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'
import { hasScoreMismatch } from '@/lib/matches/verify'
import { AdminResultsQueue } from '@/components/admin/AdminResultsQueue'
import { sideName, type SquadRef } from '@/lib/matches/sides'
import { safeFetchRegistrationFields, pickDisplayValue } from '@/lib/tournaments/registration-fields'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null
function firstT(t: TournamentRef): { title: string; slug: string } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function AdminResultsPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, is_full_day, noshow_flagged_at, tournament_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
        'team_a:squads!matches_team_a_id_fkey(id, name), ' +
        'team_b:squads!matches_team_b_id_fkey(id, name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(score_a, score_b)',
    )
    .in('status', ['scheduled', 'live', 'disputed'])

  const rawRows = (data as unknown[] | null) ?? []
  const tournamentIds = Array.from(
    new Set(rawRows.map((raw) => (raw as { tournament_id: string }).tournament_id)),
  )
  const { data: tournamentGames } =
    tournamentIds.length > 0
      ? await supabase.from('tournaments').select('id, game_id').in('id', tournamentIds)
      : { data: [] as { id: string; game_id: string }[] }
  const gameIdByTournament = new Map((tournamentGames ?? []).map((t) => [t.id, t.game_id]))
  const fieldsByGame = new Map(
    await Promise.all(
      Array.from(new Set((tournamentGames ?? []).map((t) => t.game_id))).map(
        async (gameId) => [gameId, await safeFetchRegistrationFields(supabase, gameId)] as const,
      ),
    ),
  )

  const { data: regs } =
    tournamentIds.length > 0
      ? await supabase
          .from('tournament_registrations')
          .select('tournament_id, player_id, registration_details')
          .in('tournament_id', tournamentIds)
      : { data: [] as { tournament_id: string; player_id: string; registration_details: Record<string, string> | null }[] }
  const clubByKey = new Map(
    (regs ?? []).map((r) => [
      `${r.tournament_id}:${r.player_id}`,
      pickDisplayValue(r.registration_details as Record<string, string> | null, fieldsByGame.get(gameIdByTournament.get(r.tournament_id) ?? '') ?? []),
    ]),
  )

  const rows: ReviewMatchInput[] = rawRows.map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      noshow_flagged_at: string | null
      tournament_id: string
      player_a: ProfileRef
      player_b: ProfileRef
      team_a: SquadRef
      team_b: SquadRef
      tournament: TournamentRef
      match_results: { score_a: number; score_b: number }[]
    }
    const t = firstT(m.tournament)
    const submissions = m.match_results ?? []
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
      submissionCount: submissions.length,
      hasMismatch: hasScoreMismatch(submissions.map((s) => ({ scoreA: s.score_a, scoreB: s.score_b }))),
      round: m.round,
      playerAName: sideName(m.player_a, m.team_a),
      playerBName: sideName(m.player_b, m.team_b),
      playerAClubName: m.player_a?.id ? clubByKey.get(`${m.tournament_id}:${m.player_a.id}`) ?? null : null,
      playerBClubName: m.player_b?.id ? clubByKey.get(`${m.tournament_id}:${m.player_b.id}`) ?? null : null,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
      noshowFlaggedAt: m.noshow_flagged_at,
    }
  })

  const { needsReview, noSubmission, disputed } = bucketReviewQueue(rows, new Date())

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Results to verify</h2>
      <AdminResultsQueue needsReview={needsReview} noSubmission={noSubmission} disputed={disputed} />
    </section>
  )
}
