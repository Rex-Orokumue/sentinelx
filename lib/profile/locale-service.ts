import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { LOCALES, type Locale } from '@/i18n/locales'

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

// Shared by POST /api/locale (web, which also sets the NEXT_LOCALE cookie) and PUT /me/locale.
export async function performSetLocale(
  admin: SupabaseClient<Database>,
  userId: string,
  locale: string,
): Promise<{ ok: true; locale: Locale } | { ok: false; reason: 'invalid_locale' | 'save_failed' }> {
  if (!isSupportedLocale(locale)) return { ok: false, reason: 'invalid_locale' }
  const { error } = await admin.from('profiles').update({ locale }).eq('id', userId)
  if (error) {
    console.error('[locale] update failed', { message: error.message })
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, locale }
}
