import type { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/admin'
import { effectivePrefs, type EffectivePrefs, type patchPrefsSchema } from './prefs'

type Admin = ReturnType<typeof createAdminClient>

// Shared by the mobile endpoints and the web Server Actions in lib/settings/notification-prefs.ts, so the
// two cannot drift on what a save does or what "effective" means.
export async function getPrefs(admin: Admin, userId: string): Promise<EffectivePrefs> {
  const { data, error } = await admin.from('profiles').select('notification_prefs').eq('id', userId).maybeSingle()
  // A failed read must not masquerade as "everything is on".
  if (error) throw new Error('could not read notification preferences')
  return effectivePrefs((data as { notification_prefs?: unknown } | null)?.notification_prefs)
}

// Section name in the patch -> key under profiles.notification_prefs.
const STORED_KEY = { push: 'push', whatsapp: 'whatsapp', achievementSharing: 'achievement_sharing' } as const

// Merges each present section through jsonb_merge_notification_prefs (migration 062): atomic under
// concurrent saves of different sections, and untouched sections/keys are preserved.
export async function patchPrefs(
  admin: Admin,
  userId: string,
  patch: z.infer<typeof patchPrefsSchema>,
): Promise<EffectivePrefs> {
  for (const section of Object.keys(STORED_KEY) as (keyof typeof STORED_KEY)[]) {
    const values = patch[section]
    if (!values || Object.keys(values).length === 0) continue
    const { error } = await admin.rpc('jsonb_merge_notification_prefs', {
      p_id: userId,
      p_key: STORED_KEY[section],
      p_patch: values,
    })
    if (error) {
      console.error('[prefs] patchPrefs failed', { section, code: (error as { code?: string }).code, message: error.message })
      throw new Error('could not save notification preferences')
    }
  }
  return getPrefs(admin, userId)
}
