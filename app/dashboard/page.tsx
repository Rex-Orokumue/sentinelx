import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bucketFixtures, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { FixtureSection } from '@/components/dashboard/FixtureCard'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { WithdrawalPanel, type WithdrawalRow } from '@/components/dashboard/WithdrawalPanel'
import { signOut } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Dashboard · SentinelX Esports' }

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstTournament(t: TournamentRef): { title: string; slug: string } | null {
  if (Array.isArray(t)) return t[0] ?? null
  return t
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard')

  const [profileRes, matchesRes, resultsRes, regsRes, wrRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, wins, losses, goals_scored')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`),
    supabase.from('match_results').select('match_id').eq('submitted_by', user.id),
    supabase
      .from('tournament_registrations')
      .select('id, payment_status, registered_at, tournament:tournaments(title, slug, status)')
      .eq('player_id', user.id)
      .order('registered_at', { ascending: false }),
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at',
      )
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
  ])

  const profile = profileRes.data
  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const matches: DashboardMatchInput[] = ((matchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const mm = raw as {
      id: string
      status: string
      scheduled_at: string | null
      round: string
      player_a_id: string
      player_b_id: string
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
    }
    const opponent = mm.player_a_id === user.id ? mm.player_b : mm.player_a
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      round: mm.round,
      opponentName: nameOf(opponent),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })
  const fixtures = bucketFixtures(matches, submittedMatchIds, new Date())

  const registrations: RegistrationRow[] = ((regsRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const withdrawals = (wrRes.data ?? []) as WithdrawalRow[]
  const hasPending = withdrawals.some((w) => w.status === 'pending')

  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? 'Player'

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <DashboardHeader
        name={displayName}
        wins={profile?.wins ?? 0}
        losses={profile?.losses ?? 0}
        goalsScored={profile?.goals_scored ?? 0}
      />
      <form action={signOut} className="mb-4">
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          Sign out
        </button>
      </form>
      <FixtureSection fixtures={fixtures} />
      <MyTournaments registrations={registrations} />
      <WithdrawalPanel requests={withdrawals} hasPending={hasPending} />
    </div>
  )
}
