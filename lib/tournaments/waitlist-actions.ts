'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registrationDetailsSchema } from './registration-schema'
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

  const result = await performJoinWaitlist(supabase, createAdminClient(), user.id, tournamentId, {
    displayName: parsed.data.displayName,
    whatsapp: parsed.data.whatsapp,
    clubName: parsed.data.clubName,
    ignTag: parsed.data.ignTag || null,
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
