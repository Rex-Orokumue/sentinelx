import { z } from 'zod'

export const PUSH_PREF_KEYS = [
  'match_reminder', 'result_confirmed', 'achievement_unlocked', 'challenge_completed', 'new_announcement',
  'tournament_announced', 'wager_settled', 'referral_converted', 'post_comment', 'post_reaction',
  'bracket_released', 'match_assigned', 'prize_credited', 'status_from_friend', 'status_viewed',
  'new_follower', 'direct_message',
] as const
export const WHATSAPP_PREF_KEYS = [
  'match_reminder', 'result_confirmed', 'prize_credited', 'challenge_completed', 'achievement_unlocked', 'registration_confirmed',
] as const
export const SHARING_PREF_KEYS = ['tournament', 'milestone', 'streak', 'social', 'other'] as const

export type PushPrefKey = (typeof PUSH_PREF_KEYS)[number]
export type WhatsappPrefKey = (typeof WHATSAPP_PREF_KEYS)[number]
export type SharingPrefKey = (typeof SHARING_PREF_KEYS)[number]

// Same defaults the settings page and the profiles.notification_prefs column default use. Nothing sends
// WhatsApp or achievement-sharing off these (they are stored preferences only), so there is no sender
// behaviour to diverge from; the website's displayed defaults are the reference.
const WHATSAPP_DEFAULTS: Record<WhatsappPrefKey, boolean> = {
  match_reminder: true, result_confirmed: true, prize_credited: true,
  challenge_completed: false, achievement_unlocked: false, registration_confirmed: true,
}
const SHARING_DEFAULTS: Record<SharingPrefKey, boolean> = {
  tournament: true, milestone: true, streak: true, social: false, other: false,
}

export interface EffectivePrefs {
  push: Record<PushPrefKey, boolean>
  whatsapp: Record<WhatsappPrefKey, boolean>
  achievementSharing: Record<SharingPrefKey, boolean>
}

function section(raw: unknown, key: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const s = (raw as Record<string, unknown>)[key]
  return typeof s === 'object' && s !== null && !Array.isArray(s) ? (s as Record<string, unknown>) : {}
}

function resolve<K extends string>(
  stored: Record<string, unknown>,
  keys: readonly K[],
  defaults: (k: K) => boolean,
): Record<K, boolean> {
  const out = {} as Record<K, boolean>
  for (const k of keys) out[k] = typeof stored[k] === 'boolean' ? (stored[k] as boolean) : defaults(k)
  return out
}

export function effectivePrefs(raw: unknown): EffectivePrefs {
  return {
    push: resolve(section(raw, 'push'), PUSH_PREF_KEYS, () => true),
    whatsapp: resolve(section(raw, 'whatsapp'), WHATSAPP_PREF_KEYS, (k) => WHATSAPP_DEFAULTS[k]),
    achievementSharing: resolve(section(raw, 'achievement_sharing'), SHARING_PREF_KEYS, (k) => SHARING_DEFAULTS[k]),
  }
}

// The sender's gate: only an explicit false suppresses. Takes any type string rather than effectivePrefs().push[type]
// because push-only types without a pref key (status_removed) are not in that record; they are never stored as
// false (patchPrefsSchema rejects the key), so they always send.
export function isPushEnabled(raw: unknown, type: string): boolean {
  return section(raw, 'push')[type] !== false
}

const bools = <K extends string>(keys: readonly K[]) =>
  z
    .object(Object.fromEntries(keys.map((k) => [k, z.boolean().optional()])) as Record<K, z.ZodOptional<z.ZodBoolean>>)
    .strict()

export const patchPrefsSchema = z
  .object({
    push: bools(PUSH_PREF_KEYS).optional(),
    whatsapp: bools(WHATSAPP_PREF_KEYS).optional(),
    achievementSharing: bools(SHARING_PREF_KEYS).optional(),
  })
  .strict()
