'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateStatusInput } from './status-schema'
import { fetchStatusViewers, type StatusViewerRow } from './status-query'
import { notifyFriendsOfNewStatus, notifyStatusViewed } from './status-notify'

export type { StatusViewerRow }

export async function postStatus(input: {
  imageUrl?: string | null
  caption?: string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post a status.' }

  const validated = validateStatusInput(input)
  if (!validated.ok) return { error: validated.error }

  const { data, error } = await supabase
    .from('player_statuses')
    .insert({
      player_id: user.id,
      image_url: validated.data.imageUrl,
      caption: validated.data.caption,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[postStatus] insert failed', { userId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post your status. Please try again.' }
  }

  // Notify friends only on the player's FIRST currently-live status — posting
  // a 2nd/3rd while the first is still up is not a new event to announce.
  // This runs after the insert, so "exactly 1 live" means this is the first.
  const admin = createAdminClient()
  const { count: liveCount } = await admin
    .from('player_statuses')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', user.id)
    .gt('expires_at', new Date().toISOString())

  if ((liveCount ?? 0) === 1) {
    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()
    const authorName = profile?.display_name ?? profile?.username ?? 'A player'
    void notifyFriendsOfNewStatus(admin, { authorId: user.id, authorName })
  }

  revalidatePath('/community')
  return { id: data.id }
}

export async function deleteStatus(id: string): Promise<{ error?: string }> {
  if (!id) return { error: 'Missing status.' }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  // RLS (player_statuses_own_delete) already restricts this to the author;
  // the explicit check just makes the error friendly instead of a silent no-op.
  const { data: row } = await supabase
    .from('player_statuses')
    .select('player_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { error: 'That status is already gone.' }
  if (row.player_id !== user.id) return { error: 'You can only delete your own status.' }

  const { error } = await supabase.from('player_statuses').delete().eq('id', id)
  if (error) return { error: 'Could not delete this status. Please try again.' }

  revalidatePath('/community')
  return {}
}

// Best-effort. A failure to record a view must never break playback, so this
// swallows everything and returns void. The unique (status_id, viewer_id)
// constraint makes a repeat view a no-op conflict — with ignoreDuplicates the
// upsert returns no row in that case and one row on a genuine first view,
// which is exactly the "notify the author once per distinct viewer" signal.
export async function recordStatusView(id: string): Promise<void> {
  if (!id) return
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: inserted } = await supabase
      .from('status_views')
      .upsert(
        { status_id: id, viewer_id: user.id },
        { onConflict: 'status_id,viewer_id', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()

    if (!inserted) return // repeat view — already recorded, already notified

    const admin = createAdminClient()
    const { data: statusRow } = await admin
      .from('player_statuses')
      .select('player_id')
      .eq('id', id)
      .maybeSingle()
    const authorId = statusRow?.player_id
    if (!authorId || authorId === user.id) return

    const { data: viewer } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle()
    const viewerName = viewer?.display_name ?? viewer?.username ?? 'Someone'

    void notifyStatusViewed(admin, { authorId, viewerId: user.id, viewerName, statusId: id })
  } catch {
    // swallow — see comment above
  }
}

export async function getStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  if (!statusId) return []
  return fetchStatusViewers(statusId)
}
