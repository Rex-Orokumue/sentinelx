import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = ReturnType<typeof createAdminClient>

export type WaitlistErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'waitlist_not_open'
  | 'rules_agreement_required' | 'already_on_waitlist' | 'already_registered' | 'waitlist_failed'

export type WaitlistInput = { displayName: string; whatsapp: string; clubName: string; ignTag: string | null; agreedToRules: boolean }
export type WaitlistResult = { ok: false; errorCode: WaitlistErrorCode } | { ok: true; tournamentSlug: string }

// Extracted from lib/tournaments/waitlist-actions.ts's joinWaitlist().
export async function performJoinWaitlist(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  tournamentId: string,
  input: WaitlistInput,
): Promise<WaitlistResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'waitlist_failed' }

  const { data: callerProfile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!callerProfile?.username) return { ok: false, errorCode: 'needs_username' }

  const { data: tournament } = await supabase.from('tournaments').select('id, slug, status, rules').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }
  if (tournament.status !== 'registration_closed' && tournament.status !== 'active') return { ok: false, errorCode: 'waitlist_not_open' }
  if (tournament.rules && !input.agreedToRules) return { ok: false, errorCode: 'rules_agreement_required' }

  const { data: existing } = await supabase.from('tournament_registrations').select('id, status').eq('tournament_id', tournamentId).eq('player_id', userId).maybeSingle()
  if (existing) return { ok: false, errorCode: existing.status === 'waitlisted' ? 'already_on_waitlist' : 'already_registered' }

  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId, player_id: userId, payment_status: 'pending', status: 'waitlisted',
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp, reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  })
  if (insErr) return { ok: false, errorCode: 'waitlist_failed' }

  return { ok: true, tournamentSlug: tournament.slug }
}
