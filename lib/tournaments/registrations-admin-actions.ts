'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { disqualifySchema, substituteSchema } from './disqualify-schema'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { disqualifyKey } from '@/lib/notifications/keys'

export type DisqualifyState = { error?: string; success?: boolean } | undefined

// Admin-only (CLAUDE.md: moderators cannot ban players). Independent of
// payment_status — refund, if any, is a separate manual refundRegistration
// call, never automatic.
export async function disqualifyRegistration(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState> {
  await requireAdmin()
  const registrationId = String(formData.get('registrationId') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const tournamentTitle = String(formData.get('tournamentTitle') ?? 'the tournament')
  if (!registrationId || !tournamentId || !playerId) return { error: 'Missing registration.' }

  const parsed = disqualifySchema.safeParse({ reason: formData.get('reason') ?? '' })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()

  // Atomic conditional update — only an active registration can be disqualified.
  const { data: claimed } = await admin
    .from('tournament_registrations')
    .update({
      status: 'disqualified',
      disqualified_at: new Date().toISOString(),
      disqualification_note: parsed.data.reason,
    })
    .eq('id', registrationId)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) {
    return { error: 'This registration is not active (already disqualified or withdrawn).' }
  }

  await admin.from('sentinel_score_events').insert({
    player_id: playerId,
    match_id: null,
    event_type: 'admin_flag_conduct',
    points_delta: -5,
    note: `Disqualified from ${tournamentTitle}: ${parsed.data.reason}`,
  })

  await notify({
    type: 'player_disqualified',
    playerId,
    dedupeKey: disqualifyKey(registrationId),
    tournament: tournamentTitle,
    reason: parsed.data.reason,
  })
  await notifyInApp({
    playerId,
    type: 'player_disqualified',
    title: 'Removed from tournament',
    body: `You've been removed from ${tournamentTitle}. Reason: ${parsed.data.reason}`,
  })

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}

// Reassigns only not-yet-played matches and the group_memberships row — see
// design spec section C. Already-completed matches keep the removed player's
// id untouched; the substitute's standings are derived purely from matches
// they actually play going forward (recomputeGroupAndMaybeAdvance already
// does this once matches are repointed — no manual stat reset needed).
export async function addSubstitute(_prev: DisqualifyState, formData: FormData): Promise<DisqualifyState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const disqualifiedRegistrationId = String(formData.get('disqualifiedRegistrationId') ?? '')
  if (!tournamentId || !disqualifiedRegistrationId) return { error: 'Missing tournament or disqualified registration.' }

  const parsed = substituteSchema.safeParse({ username: formData.get('username') ?? '' })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()

  const { data: removedReg } = await admin
    .from('tournament_registrations')
    .select('id, player_id, status')
    .eq('id', disqualifiedRegistrationId)
    .maybeSingle()
  if (!removedReg) return { error: 'Disqualified registration not found.' }
  if (removedReg.status !== 'disqualified') return { error: 'This registration has not been disqualified.' }

  const { data: sub } = await admin
    .from('profiles')
    .select('id, display_name, username, whatsapp_number')
    .ilike('username', parsed.data.username)
    .maybeSingle()
  if (!sub) return { error: `No player found with username "${parsed.data.username}".` }
  if (sub.id === removedReg.player_id) return { error: 'The substitute cannot be the removed player.' }

  // A player who already joined the waitlist for this tournament has a
  // registration row with their reg_* details already captured — promote
  // that row in place instead of inserting a second one, which would
  // violate the tournament_id + player_id unique constraint.
  const { data: waitlisted } = await admin
    .from('tournament_registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', sub.id)
    .eq('status', 'waitlisted')
    .maybeSingle()

  if (waitlisted) {
    const { error: upErr } = await admin
      .from('tournament_registrations')
      .update({
        status: 'active',
        payment_status: 'paid',
        fee_waived: false,
        replaces_registration_id: removedReg.id,
      })
      .eq('id', waitlisted.id)
    if (upErr) return { error: 'Could not register the substitute. Please try again.' }
  } else {
    // Not gathered by any form for an admin-picked substitute (unlike a
    // normal self-registration or a waitlist join) — best-effort backfill
    // from the player's profile so the registrations table isn't left blank.
    const { error: insErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: sub.id,
      payment_status: 'paid',
      fee_waived: false,
      status: 'active',
      replaces_registration_id: removedReg.id,
      reg_display_name: sub.display_name ?? sub.username,
      reg_whatsapp: sub.whatsapp_number,
    })
    if (insErr) {
      if ((insErr as { code?: string }).code === '23505') {
        return { error: 'This player is already registered for this tournament.' }
      }
      return { error: 'Could not register the substitute. Please try again.' }
    }
  }

  // Reassign not-yet-played matches to the substitute.
  const { data: pending } = await admin
    .from('matches')
    .select('id, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live'])
    .or(`player_a_id.eq.${removedReg.player_id},player_b_id.eq.${removedReg.player_id}`)
  for (const m of pending ?? []) {
    const patch =
      m.player_a_id === removedReg.player_id ? { player_a_id: sub.id } : { player_b_id: sub.id }
    await admin.from('matches').update(patch).eq('id', m.id)
  }

  // Repoint the group_memberships row, if any — stats then derive purely
  // from matches the substitute actually plays via the existing recompute.
  const { data: tournamentGroups } = await admin.from('groups').select('id').eq('tournament_id', tournamentId)
  const groupIds = (tournamentGroups ?? []).map((g) => g.id)
  if (groupIds.length > 0) {
    await admin
      .from('group_memberships')
      .update({ player_id: sub.id })
      .eq('player_id', removedReg.player_id)
      .in('group_id', groupIds)
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true }
}
