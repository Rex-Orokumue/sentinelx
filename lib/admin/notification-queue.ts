import { createClient } from '@/lib/supabase/server'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  sortByCreatedAtDesc,
  type AdminNotificationItem,
} from './notification-copy'

export type { AdminNotificationType, AdminNotificationItem } from './notification-copy'
export { countByHref } from './notification-copy'

type SupabaseClient = ReturnType<typeof createClient>
type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null

function nameOf(p: ProfileRef): string {
  const row = Array.isArray(p) ? p[0] ?? null : p
  return row?.display_name ?? row?.username ?? 'Player'
}

// MERGE DEPENDENCY — #28 (feat/28-30-wallet-perks-recordings): when that
// branch merges:
//   1. Delete the referral_withdrawal_requests query below and its mapped
//      items (referral_withdrawal_requests is dropped).
//   2. Delete the friendly_withdrawal_requests query below and its mapped
//      items (friendly_withdrawal_requests is dropped).
//   3. withdrawal_requests survives with the same name but widened scope —
//      keep its query, but update the link in notification-copy.ts's
//      TYPE_LINK from '/admin/withdrawals' to '/admin/wallet'.
// Net effect: 3 withdrawal notification types collapse into 1.
async function fetchWithdrawalItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type Row = { id: string; amount: number; requested_at: string; profiles: ProfileRef }

  const [{ data: w }, { data: r }, { data: f }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .in('status', ['pending', 'failed']),
    supabase
      .from('referral_withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .eq('status', 'pending'),
    supabase
      .from('friendly_withdrawal_requests')
      .select('id, amount, requested_at, profiles(username, display_name)')
      .eq('status', 'pending'),
  ])

  function toItems(
    rows: unknown[] | null,
    type: 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending',
  ): AdminNotificationItem[] {
    return ((rows as Row[] | null) ?? []).map((row) =>
      withdrawalNotification({
        type,
        username: nameOf(row.profiles),
        amount: row.amount,
        createdAt: row.requested_at,
      }),
    )
  }

  return [
    ...toItems(w, 'withdrawal_pending'),
    ...toItems(r, 'referral_withdrawal_pending'),
    ...toItems(f, 'friendly_withdrawal_pending'),
  ]
}

async function fetchExchangeItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type Row = {
    id: string
    title: string
    created_at: string
    seller: { username: string | null } | { username: string | null }[] | null
  }
  const { data } = await supabase
    .from('marketplace_listings')
    .select('id, title, created_at, seller:profiles!marketplace_listings_seller_id_fkey(username)')
    .eq('status', 'pending')

  return ((data as unknown[] | null) ?? []).map((raw) => {
    const l = raw as Row
    const seller = Array.isArray(l.seller) ? l.seller[0] ?? null : l.seller
    return exchangeListingNotification({
      title: l.title,
      sellerName: seller?.username ?? 'seller',
      createdAt: l.created_at,
    })
  })
}

async function fetchResultItems(supabase: SupabaseClient): Promise<AdminNotificationItem[]> {
  type NameRef = ProfileRef
  type TournamentRef = { title: string } | { title: string }[] | null
  type Row = {
    id: string
    round: string
    status: string
    scheduled_at: string | null
    is_full_day: boolean
    auto_expired: boolean
    created_at: string
    player_a: NameRef
    player_b: NameRef
    tournament: TournamentRef
    match_results: { count: number }[]
  }

  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, is_full_day, auto_expired, created_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'tournament:tournaments(title), match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed', 'cancelled'])

  const rows = ((data as unknown[] | null) ?? []) as Row[]
  const createdAtById = new Map(rows.map((r) => [r.id, r.created_at]))

  const reviewInputs: ReviewMatchInput[] = rows.map((m) => {
    const t = Array.isArray(m.tournament) ? m.tournament[0] ?? null : m.tournament
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
      autoExpired: m.auto_expired,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: '',
    }
  })

  const { needsReview, disputed } = bucketReviewQueue(reviewInputs, new Date())

  return [
    ...needsReview.map((m) =>
      resultNotification({
        type: 'result_needs_review',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
    ...disputed.map((m) =>
      resultNotification({
        type: 'result_disputed',
        tournamentTitle: m.tournamentTitle,
        playerAName: m.playerAName,
        playerBName: m.playerBName,
        createdAt: createdAtById.get(m.id) ?? new Date().toISOString(),
      }),
    ),
  ]
}

export async function getAdminNotificationQueue(
  staffRole: 'admin' | 'moderator',
): Promise<AdminNotificationItem[]> {
  const supabase = createClient()

  const [exchangeItems, resultItems, withdrawalItems] = await Promise.all([
    fetchExchangeItems(supabase),
    fetchResultItems(supabase),
    staffRole === 'admin' ? fetchWithdrawalItems(supabase) : Promise.resolve([]),
  ])

  return sortByCreatedAtDesc([...exchangeItems, ...resultItems, ...withdrawalItems])
}
