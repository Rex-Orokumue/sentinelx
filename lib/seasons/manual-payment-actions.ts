'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
import { notify } from '@/lib/notifications/notify'
import { regKey } from '@/lib/notifications/keys'

export type ManualPaymentState = { error?: string; success?: boolean } | undefined

const paymentSchema = z.object({
  tournamentId: z.uuid(),
  playerId: z.uuid(),
  amount: z.coerce.number().int().positive(),
  channel: z.enum(['bank_transfer', 'cash', 'other']),
  reference: z.string().trim().min(4).max(120),
  note: z.string().trim().max(500),
})

type Settlement = {
  status: string
  newlyPaid?: boolean
  registrationId?: string
  tournamentTitle?: string
  fee?: number
}

const statusErrors: Record<string, string> = {
  not_admin: 'Only an admin can record a manual payment.',
  invalid_reference: 'Enter a valid transaction reference.',
  tournament_not_found: 'This invitation tournament was not found.',
  registration_closed: 'Registration is closed.',
  wrong_amount: 'The received amount must equal the tournament entry fee.',
  invitation_not_found: 'This player does not have an invitation.',
  invitation_declined: 'This player declined the invitation.',
  player_not_found: 'This player account is no longer available.',
  already_paid: 'This player is already paid. No second payment was recorded.',
  registration_unavailable: 'This registration cannot be marked paid.',
  no_slot: 'There is no open invitation slot for this player.',
}

export async function recordManualPayment(_prev: ManualPaymentState, formData: FormData): Promise<ManualPaymentState> {
  const ctx = await requireAdmin()
  if (formData.get('verified') !== 'yes') return { error: 'Verify the transfer in your bank records first.' }

  const parsed = paymentSchema.safeParse({
    tournamentId: formData.get('tournamentId'),
    playerId: formData.get('playerId'),
    amount: formData.get('amount'),
    channel: formData.get('channel'),
    reference: formData.get('reference'),
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) {
    const invalid = parsed.error.issues[0]
    return { error: invalid.path[0] === 'reference' ? 'Enter a real transaction reference (4–120 characters).' : 'Check the payment details and try again.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('record_manual_invitation_payment', {
    p_tournament: parsed.data.tournamentId,
    p_player: parsed.data.playerId,
    p_actor: ctx.userId,
    p_amount: parsed.data.amount,
    p_channel: parsed.data.channel,
    p_reference: parsed.data.reference,
    p_note: parsed.data.note || null,
  })
  if (error) {
    if (error.code === '23505') return { error: 'This transaction reference has already been used.' }
    console.error('[recordManualPayment] settlement failed', { code: error.code, message: error.message })
    return { error: 'Could not record this payment. Please try again.' }
  }
  const result = data as Settlement
  if (result.status !== 'confirmed') return { error: statusErrors[result.status] ?? 'Could not record this payment.' }

  if (result.newlyPaid && result.registrationId) {
    await settleReferralForPaidEntry(admin, parsed.data.playerId, { registrationFee: result.fee ?? 0, feeWaived: false })
    await notify({ type: 'registration_confirmed', playerId: parsed.data.playerId,
      dedupeKey: regKey(result.registrationId), tournament: result.tournamentTitle ?? 'the tournament' })
  }
  revalidatePath(`/admin/tournaments/${parsed.data.tournamentId}/invitations`)
  revalidatePath(`/admin/tournaments/${parsed.data.tournamentId}/registrations`)
  revalidatePath('/dashboard')
  return { success: true }
}
