import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { checkCanDelete, type DeletionBlocker, type DeletionGuardInput } from './deletion-guards'
import { hashIdentifier } from './identifier-hash'
import { sendEmail } from '@/lib/email/send'

type Admin = SupabaseClient<Database>
type RawCounts = { [K in keyof DeletionGuardInput]: number | null }

// Supabase count queries return null rather than 0 when nothing matches.
export function toGuardInput(raw: RawCounts): DeletionGuardInput {
  return {
    walletBalance: raw.walletBalance ?? 0,
    pendingWithdrawals: raw.pendingWithdrawals ?? 0,
    openEscrowOrders: raw.openEscrowOrders ?? 0,
    activeListings: raw.activeListings ?? 0,
    activeTournaments: raw.activeTournaments ?? 0,
    unfinishedMatches: raw.unfinishedMatches ?? 0,
    unfinishedFriendlies: raw.unfinishedFriendlies ?? 0,
  }
}

const OPEN_ORDER = ['initiated', 'payment_held']
const LIVE_TOURNAMENT = ['registration_open', 'registration_closed', 'active']
const UNFINISHED_MATCH = ['scheduled', 'live', 'disputed']
const UNFINISHED_FRIENDLY = [
  'pending',
  'awaiting_payment',
  'active',
  'awaiting_admin_confirmation',
  'disputed',
]

export async function fetchGuardInput(admin: Admin, playerId: string): Promise<DeletionGuardInput> {
  const [
    wallet,
    withdrawals,
    ordersBuy,
    ordersSell,
    listings,
    regs,
    matchesA,
    matchesB,
    friendliesC,
    friendliesO,
  ] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle(),
    admin
      .from('withdrawal_requests')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('status', 'pending'),
    admin
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', playerId)
      .in('status', OPEN_ORDER),
    admin
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', playerId)
      .in('status', OPEN_ORDER),
    admin
      .from('marketplace_listings')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', playerId)
      .eq('status', 'active'),
    admin
      .from('tournament_registrations')
      .select('id, tournaments!inner(status)', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('status', 'active')
      .in('tournaments.status', LIVE_TOURNAMENT),
    admin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('player_a_id', playerId)
      .in('status', UNFINISHED_MATCH),
    admin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('player_b_id', playerId)
      .in('status', UNFINISHED_MATCH),
    admin
      .from('friendly_matches')
      .select('id', { count: 'exact', head: true })
      .eq('challenger_id', playerId)
      .in('status', UNFINISHED_FRIENDLY),
    admin
      .from('friendly_matches')
      .select('id', { count: 'exact', head: true })
      .eq('opponent_id', playerId)
      .in('status', UNFINISHED_FRIENDLY),
  ])

  return toGuardInput({
    walletBalance: wallet.data?.balance ?? 0,
    pendingWithdrawals: withdrawals.count,
    openEscrowOrders: (ordersBuy.count ?? 0) + (ordersSell.count ?? 0),
    activeListings: listings.count,
    activeTournaments: regs.count,
    unfinishedMatches: (matchesA.count ?? 0) + (matchesB.count ?? 0),
    unfinishedFriendlies: (friendliesC.count ?? 0) + (friendliesO.count ?? 0),
  })
}

// Shared by the cron route and "Delete now". Runs the guards, anonymises,
// records ban hashes for cheat-flagged accounts, mails the final notice, then
// revokes sign-in.
export async function executeDeletion(
  admin: Admin,
  playerId: string,
): Promise<{ ok: true } | { ok: false; blockers: DeletionBlocker[] }> {
  const blockers = checkCanDelete(await fetchGuardInput(admin, playerId))
  if (blockers.length > 0) return { ok: false, blockers }

  // Read the email, phone and cheat-flag state BEFORE anonymising — the RPC
  // clears the phone, and deleting the auth user takes the email with it.
  const { data: authUser } = await admin.auth.admin.getUserById(playerId)
  const email = authUser?.user?.email ?? null
  const { data: profile } = await admin
    .from('profiles')
    .select('phone')
    .eq('id', playerId)
    .maybeSingle()
  const { count: cheatFlags } = await admin
    .from('admin_flags')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('severity', 'cheat')

  await admin.rpc('anonymise_account', { p_id: playerId })

  // Cheat-flagged accounts only. A conduct flag (-50 SX Score) must not bar
  // someone for life. Retaining admin_flags on the tombstone does not by
  // itself stop evasion: a new account from the same email has no link to it.
  if ((cheatFlags ?? 0) > 0) {
    const pepper = process.env.DELETION_HASH_PEPPER ?? ''
    const rows: { hash: string; kind: 'email' | 'phone' }[] = []
    if (email) rows.push({ hash: hashIdentifier(email, pepper), kind: 'email' })
    if (profile?.phone) rows.push({ hash: hashIdentifier(profile.phone, pepper), kind: 'phone' })
    if (rows.length > 0) {
      await admin
        .from('banned_identifiers')
        .upsert(rows, { onConflict: 'hash', ignoreDuplicates: true })
    }
  }

  // Before the address disappears with the auth user.
  if (email) {
    await sendEmail({
      to: email,
      subject: 'Your SentinelX account has been deleted',
      html:
        '<p>Your SentinelX Esports account has been permanently deleted.</p>' +
        '<p>Your match results and tournament history remain on the platform under ' +
        '"Deleted player". This cannot be undone.</p>',
    })
  }

  const { error } = await admin.auth.admin.deleteUser(playerId)
  if (error) {
    // The profile is already anonymised and the user is effectively gone, so
    // deleted_at stands. Logged for admin follow-up rather than rolled back —
    // a rollback would resurrect an account the user has left.
    console.error('executeDeletion: auth user delete failed', playerId, error)
  }
  return { ok: true }
}
