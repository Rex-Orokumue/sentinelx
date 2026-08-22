// Consolidated account-data tool (spec §5) — ONE tool, not many narrow
// ones, for fewer round trips and more reliable tool-calling on a 70B
// model. Building the response shape (buildAccountSnapshot) is separated
// from the Supabase I/O (getAccountSnapshot) so opponent-name resolution,
// currency formatting, and defaulting are unit-testable without a database.
import type { createAdminClient } from '@/lib/supabase/admin'
import { formatNaira } from '@/lib/format'

type Admin = ReturnType<typeof createAdminClient>

export interface AccountSnapshot {
  upcomingMatches: { opponentName: string; scheduledAt: string | null; tournamentName: string; status: string }[]
  registrations: { tournamentName: string; status: string; paymentStatus: string }[]
  // One figure — since the #28 unified wallet system, prize/referral/
  // friendly-stake winnings all land in the same wallets.balance (see
  // Global Constraints "Schema deviation").
  walletBalanceNaira: string
  sxCoinBalance: number
  sxScore: number
  sxTier: string | null
  membershipTier: string
  recentWithdrawals: { amountNaira: string; status: string; requestedAt: string }[]
  kycStatus: string
  friendlyMatches: { opponentName: string; status: string; stakeAmountNaira: string | null }[]
  unreadNotificationCount: number
}

type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
type TournamentRef = { title: string } | { title: string }[] | null

// Supabase sometimes returns a single-row embed as an array (same gotcha
// documented in app/dashboard/matches/page.tsx) — handle both shapes.
function nameOf(p: ProfileRef): string {
  const one = Array.isArray(p) ? (p[0] ?? null) : p
  return one?.display_name ?? one?.username ?? 'Opponent'
}
function titleOf(t: TournamentRef): string {
  const one = Array.isArray(t) ? (t[0] ?? null) : t
  return one?.title ?? 'Tournament'
}

export interface RawMatchRow {
  status: string
  scheduled_at: string | null
  player_a_id: string
  player_b_id: string
  player_a: ProfileRef
  player_b: ProfileRef
  tournament: TournamentRef
}
export interface RawRegistrationRow {
  status: string
  payment_status: string
  tournament: TournamentRef
}
export interface RawWithdrawalRow {
  amount: number
  status: string
  requested_at: string
}
export interface RawFriendlyMatchRow {
  challenger_id: string
  opponent_id: string
  status: string
  stake_amount: number | null
  challenger: ProfileRef
  opponent: ProfileRef
}

export interface AccountSnapshotRawInput {
  playerId: string
  matches: RawMatchRow[]
  registrations: RawRegistrationRow[]
  walletBalance: number
  sxCoinBalance: number
  profile: { sx_score: number; sentinel_tier: string | null; membership_tier: string } | null
  kycStatus: string
  withdrawals: RawWithdrawalRow[]
  friendlyMatches: RawFriendlyMatchRow[]
  unreadNotificationCount: number
}

// Pure — unit tested directly.
export function buildAccountSnapshot(input: AccountSnapshotRawInput): AccountSnapshot {
  return {
    upcomingMatches: input.matches.map((m) => ({
      opponentName: nameOf(m.player_a_id === input.playerId ? m.player_b : m.player_a),
      scheduledAt: m.scheduled_at,
      tournamentName: titleOf(m.tournament),
      status: m.status,
    })),
    registrations: input.registrations.map((r) => ({
      tournamentName: titleOf(r.tournament),
      status: r.status,
      paymentStatus: r.payment_status,
    })),
    walletBalanceNaira: formatNaira(input.walletBalance),
    sxCoinBalance: input.sxCoinBalance,
    sxScore: input.profile?.sx_score ?? 700,
    sxTier: input.profile?.sentinel_tier ?? null,
    membershipTier: input.profile?.membership_tier ?? 'rookie',
    recentWithdrawals: input.withdrawals.map((w) => ({
      amountNaira: formatNaira(w.amount),
      status: w.status,
      requestedAt: w.requested_at,
    })),
    kycStatus: input.kycStatus,
    friendlyMatches: input.friendlyMatches.map((f) => ({
      opponentName: nameOf(f.challenger_id === input.playerId ? f.opponent : f.challenger),
      status: f.status,
      stakeAmountNaira: f.stake_amount != null ? formatNaira(f.stake_amount) : null,
    })),
    unreadNotificationCount: input.unreadNotificationCount,
  }
}

// Supabase-js resolves query errors as {data: null, error} — it does not
// reject — so Promise.all here is safe; each field below independently
// degrades to an empty/default value on that one query's error, matching
// spec §7 "get_account_snapshot() partial failure".
export async function getAccountSnapshot(admin: Admin, playerId: string): Promise<AccountSnapshot> {
  const [matchesRes, registrationsRes, walletRes, coinsRes, profileRes, kycRes, withdrawalsRes, friendlyRes, notifRes] =
    await Promise.all([
      admin
        .from('matches')
        .select(
          'status, scheduled_at, player_a_id, player_b_id, ' +
            'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
            'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
            'tournament:tournaments(title)',
        )
        .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
        .in('status', ['scheduled', 'live']),
      admin
        .from('tournament_registrations')
        .select('status, payment_status, tournament:tournaments(title)')
        .eq('player_id', playerId)
        .order('registered_at', { ascending: false })
        .limit(10),
      admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle(),
      admin.from('sx_coins').select('balance').eq('player_id', playerId).maybeSingle(),
      admin.from('profiles').select('sx_score, sentinel_tier, membership_tier').eq('id', playerId).maybeSingle(),
      admin.from('player_kyc').select('kyc_status').eq('player_id', playerId).maybeSingle(),
      admin
        .from('withdrawal_requests')
        .select('amount, status, requested_at')
        .eq('player_id', playerId)
        .order('requested_at', { ascending: false })
        .limit(5),
      admin
        .from('friendly_matches')
        .select(
          'challenger_id, opponent_id, status, stake_amount, ' +
            'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
            'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
        )
        .or(`challenger_id.eq.${playerId},opponent_id.eq.${playerId}`)
        .in('status', ['pending', 'awaiting_payment', 'active', 'awaiting_admin_confirmation']),
      admin
        .from('player_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', playerId)
        .eq('read', false),
    ])

  return buildAccountSnapshot({
    playerId,
    matches: matchesRes.error ? [] : ((matchesRes.data as unknown as RawMatchRow[]) ?? []),
    registrations: registrationsRes.error ? [] : ((registrationsRes.data as unknown as RawRegistrationRow[]) ?? []),
    walletBalance: walletRes.error ? 0 : (walletRes.data?.balance ?? 0),
    sxCoinBalance: coinsRes.error ? 0 : (coinsRes.data?.balance ?? 0),
    profile: profileRes.error ? null : profileRes.data,
    kycStatus: kycRes.error ? 'not_started' : (kycRes.data?.kyc_status ?? 'not_started'),
    withdrawals: withdrawalsRes.error ? [] : ((withdrawalsRes.data as unknown as RawWithdrawalRow[]) ?? []),
    friendlyMatches: friendlyRes.error ? [] : ((friendlyRes.data as unknown as RawFriendlyMatchRow[]) ?? []),
    unreadNotificationCount: notifRes.error ? 0 : (notifRes.count ?? 0),
  })
}
