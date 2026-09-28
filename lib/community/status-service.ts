import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { validateStatusInput } from './status-schema'
import { notifyFriendsOfNewStatus, notifyStatusViewed } from './status-notify'

type Client = SupabaseClient<Database>
type Admin = ReturnType<typeof createAdminClient>

export type PostStatusResult = { ok: true; id: string } | { ok: false; error: string }

export async function performPostStatus(
  supabase: Client,
  admin: Admin,
  userId: string,
  input: { imageUrl?: string | null; caption?: string | null },
): Promise<PostStatusResult> {
  const validated = validateStatusInput(input)
  if (!validated.ok) return { ok: false, error: validated.error }

  const { data, error } = await supabase
    .from('player_statuses')
    .insert({ player_id: userId, image_url: validated.data.imageUrl, caption: validated.data.caption })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[performPostStatus] insert failed', { userId, code: error?.code, message: error?.message })
    return { ok: false, error: 'Could not post your status. Please try again.' }
  }

  const { count: liveCount } = await admin
    .from('player_statuses')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', userId)
    .gt('expires_at', new Date().toISOString())

  if ((liveCount ?? 0) === 1) {
    const { data: profile } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
    const authorName = profile?.display_name ?? profile?.username ?? 'A player'
    void notifyFriendsOfNewStatus(admin, { authorId: userId, authorName })
  }

  return { ok: true, id: data.id }
}

export type DeleteStatusErrorCode = 'not_found' | 'forbidden'
export type DeleteStatusResult = { ok: true } | { ok: false; errorCode: DeleteStatusErrorCode }

export async function performDeleteStatus(supabase: Client, userId: string, statusId: string): Promise<DeleteStatusResult> {
  const { data: row } = await supabase.from('player_statuses').select('player_id').eq('id', statusId).maybeSingle()
  if (!row) return { ok: false, errorCode: 'not_found' }
  if (row.player_id !== userId) return { ok: false, errorCode: 'forbidden' }
  await supabase.from('player_statuses').delete().eq('id', statusId)
  return { ok: true }
}

// Best-effort, same as recordStatusView (status-actions.ts) — a failure here
// must never surface as an error the mobile caller has to handle.
export async function performRecordStatusView(supabase: Client, admin: Admin, userId: string, statusId: string): Promise<void> {
  try {
    const { data: inserted } = await supabase
      .from('status_views')
      .upsert({ status_id: statusId, viewer_id: userId }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()
    if (!inserted) return

    const { data: statusRow } = await admin.from('player_statuses').select('player_id').eq('id', statusId).maybeSingle()
    const authorId = statusRow?.player_id
    if (!authorId || authorId === userId) return

    const { data: viewer } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
    const viewerName = viewer?.display_name ?? viewer?.username ?? 'Someone'
    void notifyStatusViewed(admin, { authorId, viewerId: userId, viewerName, statusId })
  } catch {
    // swallow — see comment above
  }
}
