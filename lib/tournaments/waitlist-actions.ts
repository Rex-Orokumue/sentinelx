'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fixedRegistrationSchema } from './registration-schema'
import { buildRegistrationSchema, fetchRegistrationFields } from './registration-fields'
import { performJoinWaitlist, type WaitlistErrorCode } from './waitlist-service'

export type JoinWaitlistState = { error?: string; success?: boolean; needsUsername?: boolean } | undefined

const ERROR_MESSAGES: Record<WaitlistErrorCode, string> = {
  needs_username: 'Claim a username before joining the waitlist.',
  tournament_not_found: 'Tournament not found.',
  waitlist_not_open: 'The waitlist is only open once registration has closed.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_on_waitlist: "You're already on the waitlist.",
  already_registered: "You're already registered for this tournament.",
  waitlist_failed: 'Could not join the waitlist. Please try again.',
}

// A player signals availability as a potential substitute once registration
// is closed/active. No payment — admin promotes a waitlisted entry into a
// paid substitute registration via addSubstitute
// (lib/tournaments/registrations-admin-actions.ts) when a slot opens.
export async function joinWaitlist(_prev: JoinWaitlistState, formData: FormData): Promise<JoinWaitlistState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()

  const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  const fixedParsed = fixedRegistrationSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
  })
  if (!fixedParsed.success) return { error: fixedParsed.error.issues[0].message }

  const fields = await fetchRegistrationFields(supabase, tournament.game_id)
  const dynamicParsed = buildRegistrationSchema(fields).safeParse(
    Object.fromEntries(fields.map((f) => [f.fieldKey, formData.get(f.fieldKey) ?? ''])),
  )
  if (!dynamicParsed.success) return { error: dynamicParsed.error.issues[0].message }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to join the waitlist.' }

  const result = await performJoinWaitlist(supabase, createAdminClient(), user.id, tournamentId, {
    displayName: fixedParsed.data.displayName,
    whatsapp: fixedParsed.data.whatsapp,
    registrationDetails: dynamicParsed.data,
    agreedToRules: formData.get('agreedToRules') === 'true',
  })

  if (!result.ok) {
    return result.errorCode === 'needs_username'
      ? { error: ERROR_MESSAGES.needs_username, needsUsername: true }
      : { error: ERROR_MESSAGES[result.errorCode] }
  }

  revalidatePath(`/tournaments/${result.tournamentSlug}`)
  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
