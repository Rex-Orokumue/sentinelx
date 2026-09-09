'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateStatusInput } from './status-schema'
import { fetchStatusViewers, type StatusViewerRow } from './status-query'

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
// constraint makes a repeat view a no-op conflict, which we ignore.
export async function recordStatusView(id: string): Promise<void> {
  if (!id) return
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('status_views')
      .upsert(
        { status_id: id, viewer_id: user.id },
        { onConflict: 'status_id,viewer_id', ignoreDuplicates: true },
      )
  } catch {
    // swallow — see comment above
  }
}

export async function getStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  if (!statusId) return []
  return fetchStatusViewers(statusId)
}
