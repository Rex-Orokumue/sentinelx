'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performRequestPhoneCode, performConfirmPhoneCode } from './service'

export type PhoneActionState = { error?: string; success?: boolean } | undefined

const REQUEST_ERRORS = {
  invalid_phone: 'Enter a valid phone number, including your country code if you are outside Nigeria.',
  cooldown: 'Please wait a minute before requesting another code.',
  daily_limit: 'Too many codes requested today. Please try again tomorrow.',
  unavailable: 'Could not send a code. Please try again.',
  send_failed: 'Could not send the WhatsApp message. Please try again.',
  save_failed: 'Could not send a code. Please try again.',
} as const

const CONFIRM_ERRORS = {
  invalid_code: 'Enter the 6-digit code',
  missing: 'Request a new code first.',
  expired: 'That code expired. Request a new one.',
  attempts_exceeded: 'Too many incorrect attempts. Request a new code.',
  wrong: 'Incorrect code.',
} as const

export async function requestPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performRequestPhoneCode({
    admin: createAdminClient(),
    userId: user.id,
    rawPhone: String(formData.get('phone') ?? ''),
    // The web has always reported success when the sender is unconfigured; only the mobile API refuses.
    strictDelivery: false,
  })
  return result.ok ? { success: true } : { error: REQUEST_ERRORS[result.reason] }
}

export async function confirmPhoneCode(
  _prev: PhoneActionState,
  formData: FormData,
): Promise<PhoneActionState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performConfirmPhoneCode({
    admin: createAdminClient(),
    userId: user.id,
    code: String(formData.get('code') ?? ''),
  })
  if (!result.ok) return { error: CONFIRM_ERRORS[result.reason] }

  revalidatePath('/dashboard')
  return { success: true }
}
