import { createClient } from '@/lib/supabase/server'
import { groupIntoRings, type StatusRing, type StatusRow } from './statuses'

const PROFILE_FIELDS = 'id, username, display_name, avatar_url'

type ProfileRef =
  | { id: string; username: string | null; display_name: string | null; avatar_url: string | null }
  | { id: string; username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null

function firstProfile(a: ProfileRef) {
  return Array.isArray(a) ? (a[0] ?? null) : a
}

type RawStatus = {
  id: string
  player_id: string
  image_url: string | null
  caption: string | null
  created_at: string
  expires_at: string
  author: ProfileRef
}

// Live statuses only — expires_at > now() is the mechanism, not a job. One
// query for the statuses + authors, one for this viewer's own view rows.
export async function fetchStatusRings(viewerId: string | null): Promise<StatusRing[]> {
  const supabase = createClient()
  const nowIso = new Date().toISOString()

  const { data: rows, error } = await supabase
    .from('player_statuses')
    .select(
      `id, player_id, image_url, caption, created_at, expires_at,
       author:profiles!player_statuses_player_id_fkey(${PROFILE_FIELDS})`,
    )
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })

  if (error || !rows || rows.length === 0) return []

  const statuses: StatusRow[] = (rows as unknown as RawStatus[]).map((r) => {
    const a = firstProfile(r.author)
    return {
      id: r.id,
      playerId: r.player_id,
      imageUrl: r.image_url,
      caption: r.caption,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      authorName: a?.display_name ?? a?.username ?? 'Player',
      authorUsername: a?.username ?? null,
      authorAvatarUrl: a?.avatar_url ?? null,
    }
  })

  let viewedIds = new Set<string>()
  if (viewerId) {
    const statusIds = statuses.map((s) => s.id)
    const { data: views } = await supabase
      .from('status_views')
      .select('status_id')
      .eq('viewer_id', viewerId)
      .in('status_id', statusIds)
    viewedIds = new Set((views ?? []).map((v) => v.status_id))
  }

  return groupIntoRings(statuses, viewedIds, viewerId)
}

export type StatusViewerRow = {
  viewerId: string
  name: string
  username: string | null
  avatarUrl: string | null
  viewedAt: string
}

// RLS (status_views_author_or_self_read + status_views_staff_read) returns rows
// only to the status's author or staff; anyone else gets an empty list.
export async function fetchStatusViewers(statusId: string): Promise<StatusViewerRow[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('status_views')
    .select(
      `viewer_id, viewed_at,
       viewer:profiles!status_views_viewer_id_fkey(${PROFILE_FIELDS})`,
    )
    .eq('status_id', statusId)
    .order('viewed_at', { ascending: false })

  type Row = { viewer_id: string; viewed_at: string; viewer: ProfileRef }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const v = firstProfile(r.viewer)
    return {
      viewerId: r.viewer_id,
      name: v?.display_name ?? v?.username ?? 'Player',
      username: v?.username ?? null,
      avatarUrl: v?.avatar_url ?? null,
      viewedAt: r.viewed_at,
    }
  })
}
