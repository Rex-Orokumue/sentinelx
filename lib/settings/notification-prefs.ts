'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const whatsappPrefsSchema = z.object({
  match_reminder: z.boolean(),
  result_confirmed: z.boolean(),
  prize_credited: z.boolean(),
  challenge_completed: z.boolean(),
  achievement_unlocked: z.boolean(),
  registration_confirmed: z.boolean(),
})

const achievementSharingSchema = z.object({
  tournament: z.boolean(),
  milestone: z.boolean(),
  streak: z.boolean(),
  social: z.boolean(),
  other: z.boolean(),
})

export type PrefsState = { error?: string; success?: boolean } | undefined

function boolFromForm(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on'
}

// Merge-patch only the `whatsapp` key of notification_prefs via the
// jsonb_merge_notification_prefs Postgres function (migration 062) — atomic
// under concurrent saves of different sub-keys, and preserves every other
// key (push, achievement_sharing, future additions) untouched.
export async function updateWhatsappPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = whatsappPrefsSchema.safeParse({
    match_reminder: boolFromForm(formData, 'match_reminder'),
    result_confirmed: boolFromForm(formData, 'result_confirmed'),
    prize_credited: boolFromForm(formData, 'prize_credited'),
    challenge_completed: boolFromForm(formData, 'challenge_completed'),
    achievement_unlocked: boolFromForm(formData, 'achievement_unlocked'),
    registration_confirmed: boolFromForm(formData, 'registration_confirmed'),
  })
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs', {
    p_id: user.id,
    p_key: 'whatsapp',
    p_patch: parsed.data,
  })
  if (error) {
    console.error('updateWhatsappPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}

const pushPrefsSchema = z.object({
  match_reminder: z.boolean(),
  result_confirmed: z.boolean(),
  achievement_unlocked: z.boolean(),
  challenge_completed: z.boolean(),
  new_announcement: z.boolean(),
  tournament_announced: z.boolean(),
  wager_settled: z.boolean(),
  referral_converted: z.boolean(),
  post_comment: z.boolean(),
  post_reaction: z.boolean(),
  bracket_released: z.boolean(),
  match_assigned: z.boolean(),
  prize_credited: z.boolean(),
})

export async function updatePushPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const keys = Object.keys(pushPrefsSchema.shape) as (keyof typeof pushPrefsSchema.shape)[]
  const parsed = pushPrefsSchema.safeParse(Object.fromEntries(keys.map((k) => [k, boolFromForm(formData, k)])))
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs', {
    p_id: user.id,
    p_key: 'push',
    p_patch: parsed.data,
  })
  if (error) {
    console.error('updatePushPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}

export async function updateAchievementSharingPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = achievementSharingSchema.safeParse({
    tournament: boolFromForm(formData, 'tournament'),
    milestone: boolFromForm(formData, 'milestone'),
    streak: boolFromForm(formData, 'streak'),
    social: boolFromForm(formData, 'social'),
    other: boolFromForm(formData, 'other'),
  })
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs', {
    p_id: user.id,
    p_key: 'achievement_sharing',
    p_patch: parsed.data,
  })
  if (error) {
    console.error('updateAchievementSharingPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}
