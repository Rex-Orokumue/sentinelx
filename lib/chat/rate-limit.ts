import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
export const RATE_LIMIT_MAX_MESSAGES = 15

// Pure — unit tested directly.
export function isOverLimit(recentEventCount: number, limit: number = RATE_LIMIT_MAX_MESSAGES): boolean {
  return recentEventCount >= limit
}

// Counts this subject's events in the trailing window, then — only if still
// under the limit — records this message as a new event. Checking BEFORE
// recording means an over-limit request is never counted twice and, more
// importantly, never reaches the Groq API at all (this is cost control, not
// just a UX nicety — see spec §4).
export async function checkAndRecordRateLimit(admin: Admin, subjectKey: string): Promise<{ ok: true } | { ok: false }> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('chat_rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('subject_key', subjectKey)
    .gte('created_at', cutoff)

  if (isOverLimit(count ?? 0)) return { ok: false }

  await admin.from('chat_rate_limit_events').insert({ subject_key: subjectKey })
  return { ok: true }
}
