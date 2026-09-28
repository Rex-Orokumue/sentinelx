'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchStatusViewers, type StatusViewerRow } from './status-query'
import { performPostStatus, performDeleteStatus, performRecordStatusView } from './status-service'

export type { StatusViewerRow }

// Core logic lives in status-service.ts, shared with the mobile-api
// endpoints — these wrappers only derive the cookie-session client/user,
// same relationship as lib/tournaments/actions.ts to register-service.ts.
export async function postStatus(input: {
  imageUrl?: string | null
  caption?: string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post a status.' }

  const result = await performPostStatus(supabase, createAdminClient(), user.id, input)
  if (!result.ok) return { error: result.error }
  revalidatePath('/community')
  return { id: result.id }
}

export async function deleteStatus(id: string): Promise<{ error?: string }> {
  if (!id) return { error: 'Missing status.' }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performDeleteStatus(supabase, user.id, id)
  if (!result.ok) {
    return { error: result.errorCode === 'not_found' ? 'That status is already gone.' : 'You can only delete your own status.' }
  }

  revalidatePath('/community')
  return {}
}

// Best-effort. A failure to record a view must never break playback — see
// performRecordStatusView's own comment.
export async function recordStatusView(id: string): Promise<void> {
  if (!id) return
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await performRecordStatusView(supabase, createAdminClient(), user.id, id)
}

export async function getStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  if (!statusId) return []
  return fetchStatusViewers(createClient(), statusId)
}
