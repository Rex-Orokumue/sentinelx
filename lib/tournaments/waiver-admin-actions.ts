'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { waiverGrantSchema } from './waiver-schema'

export type WaiverFormState = { error?: string; success?: boolean; warning?: string } | undefined

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function grantWaiver(_prev: WaiverFormState, formData: FormData): Promise<WaiverFormState> {
  const ctx = await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = waiverGrantSchema.safeParse({
    username: formData.get('username') ?? '',
    reason: formData.get('reason') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()

  // Exact, case-insensitive match — usernames are unique, so this returns at
  // most one row. Not a fuzzy substring search (unlike the /players browse page).
  const { data: player } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', parsed.data.username)
    .maybeSingle()
  if (!player) return { error: `No player found with username "${parsed.data.username}".` }

  const { error } = await supabase.from('tournament_fee_waivers').insert({
    tournament_id: tournamentId,
    player_id: player.id,
    granted_by: ctx.userId,
    reason: parsed.data.reason || null,
  })
  if (error) {
    if (isUniqueViolation(error)) {
      return { error: 'This player already has a waiver for this tournament.' }
    }
    return { error: 'Could not grant the waiver. Please try again.' }
  }

  // Not a blocker — the waiver simply won't ever be redeemed for an already-paid
  // player, but the grant might still be worth recording (e.g. an award mention).
  const { count: alreadyPaidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', player.id)
    .eq('payment_status', 'paid')

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return {
    success: true,
    warning:
      (alreadyPaidCount ?? 0) > 0
        ? 'This player is already registered — the waiver was granted, but it won’t do anything since they already paid.'
        : undefined,
  }
}

export async function revokeWaiver(_prev: WaiverFormState, formData: FormData): Promise<WaiverFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!id) return { error: 'Missing waiver.' }

  const supabase = createClient()
  // Only an unredeemed waiver can be revoked — once redeemed_at is set, it's
  // a real completed registration, not a pending grant to cancel.
  const { error } = await supabase
    .from('tournament_fee_waivers')
    .delete()
    .eq('id', id)
    .is('redeemed_at', null)
  if (error) return { error: 'Could not revoke the waiver.' }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
