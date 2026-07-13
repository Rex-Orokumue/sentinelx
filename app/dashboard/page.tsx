import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bucketFixtures, type DashboardMatchInput } from '@/lib/dashboard/fixtures'
import { DashboardHeader } from '@/components/dashboard/DashboardHeader'
import { FixtureSection } from '@/components/dashboard/FixtureCard'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { WithdrawalPanel, type WithdrawalRow } from '@/components/dashboard/WithdrawalPanel'
import { MyListings, type MyListing } from '@/components/dashboard/MyListings'
import { MyOrders } from '@/components/dashboard/MyOrders'
import { latestPerListing, type OrderRow } from '@/lib/exchange/orders'
import { MySales } from '@/components/dashboard/MySales'
import { ProfileEditForm } from '@/components/dashboard/ProfileEditForm'
import { signOut } from '@/lib/auth/actions'
import { listBanks, type Bank } from '@/lib/paystack/server'

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

  const [
    profileRes,
    matchesRes,
    resultsRes,
    regsRes,
    wrRes,
    listingsRes,
    ordersRes,
    salesRes,
    kycRes,
    banks,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, avatar_url, whatsapp_number, country, bio, wins, losses, goals_scored')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('matches')
      .select(
        'id, status, scheduled_at, round, tournament_id, player_a_id, player_b_id, ' +
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
    supabase
      .from('marketplace_listings')
      .select('id, title, price, status')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
  ])

  const profile = profileRes.data
  const myListings: MyListing[] = (listingsRes.data ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: l.price,
    status: l.status,
  }))
  const toOrderRow = (r: {
    id: string
    listing_id: string
    listing_title: string
    amount: number
    status: string
  }): OrderRow => ({
    id: r.id,
    listingId: r.listing_id,
    title: r.listing_title,
    amount: r.amount,
    status: r.status,
  })
  // Both queries are already newest-first — collapse abandoned retries of the
  // same listing down to just the latest attempt.
  const myOrders: OrderRow[] = latestPerListing((ordersRes.data ?? []).map(toOrderRow))
  const mySales: OrderRow[] = latestPerListing((salesRes.data ?? []).map(toOrderRow))

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string
    status: string
    scheduled_at: string | null
    round: string
    tournament_id: string
    player_a_id: string
    player_b_id: string
    player_a: ProfileRef
    player_b: ProfileRef
    tournament: TournamentRef
  }[]

  // Opponent WhatsApp numbers are per-tournament registration data, not
  // profile data — fetch every registration for the tournaments this player
  // has matches in, then look each opponent up by (tournament_id, player_id).
  const matchTournamentIds = Array.from(new Set(rawMatches.map((mm) => mm.tournament_id)))
  const { data: regRows } =
    matchTournamentIds.length > 0
      ? await supabase
          .from('tournament_registrations')
          .select('tournament_id, player_id, reg_whatsapp')
          .in('tournament_id', matchTournamentIds)
      : { data: [] as { tournament_id: string; player_id: string; reg_whatsapp: string | null }[] }
  const whatsappByKey = new Map((regRows ?? []).map((r) => [`${r.tournament_id}:${r.player_id}`, r.reg_whatsapp]))

  const matches: DashboardMatchInput[] = rawMatches.map((mm) => {
    const opponentId = mm.player_a_id === user.id ? mm.player_b_id : mm.player_a_id
    const opponent = mm.player_a_id === user.id ? mm.player_b : mm.player_a
    const t = firstTournament(mm.tournament)
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      round: mm.round,
      opponentName: nameOf(opponent),
      opponentWhatsapp: whatsappByKey.get(`${mm.tournament_id}:${opponentId}`) ?? null,
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

  const kyc = kycRes.data
  const withdrawals = (wrRes.data ?? []) as WithdrawalRow[]
  const hasActive = withdrawals.some((w) => w.status === 'pending' || w.status === 'processing')
  const payoutAccount =
    kyc?.payout_bank_name && kyc?.payout_account_number && kyc?.payout_account_name
      ? {
          bankName: kyc.payout_bank_name,
          accountNumber: kyc.payout_account_number,
          accountName: kyc.payout_account_name,
        }
      : null

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
      <ProfileEditForm
        profile={{
          displayName: profile?.display_name ?? null,
          username: profile?.username ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          whatsapp: profile?.whatsapp_number ?? null,
          country: profile?.country ?? null,
          bio: profile?.bio ?? null,
        }}
      />
      <FixtureSection fixtures={fixtures} />
      <MyTournaments registrations={registrations} />
      <MyListings listings={myListings} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
      <WithdrawalPanel
        requests={withdrawals}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
    </div>
  )
}
