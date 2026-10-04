import { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from '@/lib/wallet/service'
import { recordCoinTransaction } from '@/lib/coins/service'

type Admin = ReturnType<typeof createAdminClient>

export interface SquadMemberPaymentInfo {
  playerId: string
  registrationId: string
  paymentStatus: string
  feeWaived: boolean
  coinsUsed: number
  coinDiscountNaira: number
}

export interface FormingSquadRefund {
  playerId: string
  registrationId: string
  cashNaira: number
  coinsUsed: number
}

// Pure: decide what each paid member of a dropped forming squad is owed back.
// Mirrors refundRegistration's math (lib/tournaments/admin-actions.ts) and
// refundAbandonedCoinDiscounts' coin-reversal rule
// (lib/tournaments/coin-discount-refund.ts) — a forming squad at close is
// functionally an abandoned checkout, just discovered at a different trigger.
export function formingSquadRefunds(
  members: SquadMemberPaymentInfo[],
  registrationFee: number,
): FormingSquadRefund[] {
  return members
    .filter((m) => m.paymentStatus === 'paid' && !m.feeWaived)
    .map((m) => ({
      playerId: m.playerId,
      registrationId: m.registrationId,
      cashNaira: Math.max(0, registrationFee - m.coinDiscountNaira),
      coinsUsed: m.coinsUsed,
    }))
    .filter((r) => r.cashNaira > 0 || r.coinsUsed > 0)
}

// Returns the coins and credits the cash a refund is owed. Callers mark the
// registration refunded themselves, after claiming it.
async function payOutRefund(admin: Admin, refund: FormingSquadRefund, note: string): Promise<void> {
  if (refund.coinsUsed > 0) {
    await recordCoinTransaction(admin, refund.playerId, refund.coinsUsed, 'entry_discount_refund', refund.registrationId, note)
  }
  if (refund.cashNaira > 0) {
    await creditWallet(admin, refund.playerId, refund.cashNaira, 'admin_credit', refund.registrationId, note)
  }
}

// Refunds and drops every squad still 'forming' for a tournament — the
// close-time rule spec §5.3 commits to regardless of which path formed the
// squad (an admin-arranged squad is never 'forming', so this only ever fires
// on an abandoned self-serve squad).
export async function refundFormingSquads(admin: Admin, tournamentId: string): Promise<{ refundedSquads: number }> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()
  const registrationFee = tournament?.registration_fee ?? 0

  const { data: forming } = await admin
    .from('squads')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'forming')
  const squads = forming ?? []

  for (const squad of squads) {
    const { data: members } = await admin
      .from('squad_members')
      .select('player_id, registration_id')
      .eq('squad_id', squad.id)

    const registrationIds = (members ?? []).map((m) => m.registration_id).filter((id): id is string => !!id)
    const { data: regs } =
      registrationIds.length > 0
        ? await admin
            .from('tournament_registrations')
            .select('id, payment_status, fee_waived, coins_used, coin_discount_naira')
            .in('id', registrationIds)
        : { data: [] }
    const regById = new Map((regs ?? []).map((r) => [r.id, r]))

    const paymentInfo: SquadMemberPaymentInfo[] = (members ?? [])
      .filter((m) => m.registration_id)
      .map((m) => {
        const reg = regById.get(m.registration_id as string)
        return {
          playerId: m.player_id as string,
          registrationId: m.registration_id as string,
          paymentStatus: reg?.payment_status ?? 'pending',
          feeWaived: reg?.fee_waived ?? false,
          coinsUsed: reg?.coins_used ?? 0,
          coinDiscountNaira: reg?.coin_discount_naira ?? 0,
        }
      })

    for (const refund of formingSquadRefunds(paymentInfo, registrationFee)) {
      await payOutRefund(admin, refund, 'Squad refunded — registration closed before your squad filled')
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'refunded' })
        .eq('id', refund.registrationId)
        .eq('payment_status', 'paid')
    }

    await admin.from('squads').update({ status: 'withdrawn' }).eq('id', squad.id)
    // A withdrawn squad's members are no longer "in" it — delete their
    // squad_members rows so squad_members_one_squad_per_tournament doesn't
    // collide when admin-arranged auto-grouping (or a fresh self-serve join)
    // later places the same player in a different squad for this tournament.
    await admin.from('squad_members').delete().eq('squad_id', squad.id)
  }

  return { refundedSquads: squads.length }
}

export type UnplacedRefundResult = { ok: true; cashNaira: number; coinsReturned: number } | { ok: false; error: string }

// Admin resolution for the odd player an admin-arranged draw could not seat:
// takes them out of the tournament (registration 'removed', which also drops
// them from every "active paid" pool) and hands back what they paid. The claim
// is an atomic conditional update, so a double click cannot pay twice. Cash
// and coins are returned exactly as for an abandoned forming squad. A
// registration that paid nothing (fee-waived or free) is still removed.
export async function refundUnplacedRegistration(
  admin: Admin,
  tournamentId: string,
  playerId: string,
): Promise<UnplacedRefundResult> {
  const { data: seat } = await admin
    .from('squad_members')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (seat) return { ok: false, error: 'Player is in a squad — remove them from it first.' }

  const { data: reg } = await admin
    .from('tournament_registrations')
    .select('id, payment_status, fee_waived, coins_used, coin_discount_naira')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .maybeSingle()
  if (!reg) return { ok: false, error: 'No active registration for this player.' }

  const { data: tournament } = await admin
    .from('tournaments')
    .select('registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()

  const [refund] = formingSquadRefunds(
    [
      {
        playerId,
        registrationId: reg.id,
        paymentStatus: reg.payment_status,
        feeWaived: reg.fee_waived ?? false,
        coinsUsed: reg.coins_used ?? 0,
        coinDiscountNaira: reg.coin_discount_naira ?? 0,
      },
    ],
    tournament?.registration_fee ?? 0,
  )

  const { data: claimed } = await admin
    .from('tournament_registrations')
    .update({ status: 'removed' })
    .eq('id', reg.id)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) return { ok: false, error: 'This registration was already handled.' }

  if (refund) {
    await payOutRefund(admin, refund, 'Refunded — no squad place was available')
    await admin
      .from('tournament_registrations')
      .update({ payment_status: 'refunded' })
      .eq('id', reg.id)
      .eq('payment_status', 'paid')
  }
  return { ok: true, cashNaira: refund?.cashNaira ?? 0, coinsReturned: refund?.coinsUsed ?? 0 }
}
