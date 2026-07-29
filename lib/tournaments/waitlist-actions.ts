'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registrationDetailsSchema } from './registration-schema'

export type JoinWaitlistState = { error?: string; success?: boolean } | undefined

// A player signals availability as a potential substitute once registration
// is closed/active. No payment — admin promotes a waitlisted entry into a
// paid substitute registration via addSubstitute
// (lib/tournaments/registrations-admin-actions.ts) when a slot opens.
export async function joinWaitlist(_prev: JoinWaitlistState, formData: FormData): Promise<JoinWaitlistState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = registrationDetailsSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    clubName: formData.get('clubName') ?? '',
    ignTag: formData.get('ignTag') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to join the waitlist.' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, rules')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }
  if (tournament.status !== 'registration_closed' && tournament.status !== 'active') {
    return { error: 'The waitlist is only open once registration has closed.' }
  }
  // Only proves the checkbox was ticked at submit time, mirroring
  // registerForTournament's same deliberate limitation.
  if (tournament.rules && formData.get('agreedToRules') !== 'true') {
    return { error: 'Please confirm you have read and agree to the rules.' }
  }

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, status')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .maybeSingle()
  if (existing) {
    return {
      error:
        existing.status === 'waitlisted'
          ? "You're already on the waitlist."
          : "You're already registered for this tournament.",
    }
  }

  // Player has no self-INSERT-with-status RLS policy beyond ownership (staff-only
  // update, see migration 001/035) — writes go through the admin client, same
  // pattern as registerForTournament. This action's own validation above (auth,
  // tournament state, duplicate check, input schema) is the trust boundary.
  const admin = createAdminClient()
  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId,
    player_id: user.id,
    payment_status: 'pending',
    status: 'waitlisted',
    reg_display_name: parsed.data.displayName,
    reg_whatsapp: parsed.data.whatsapp,
    reg_club_name: parsed.data.clubName,
    reg_ign_tag: parsed.data.ignTag || null,
  })
  if (insErr) return { error: 'Could not join the waitlist. Please try again.' }

  revalidatePath(`/tournaments/${tournament.slug}`)
  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
