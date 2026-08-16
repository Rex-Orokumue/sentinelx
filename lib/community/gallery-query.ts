import { createClient } from '@/lib/supabase/server'

export interface GalleryItem {
  id: string
  imageUrl: string
  caption: string
  authorName: string
}

export interface GalleryPage {
  items: GalleryItem[]
  hasMore: boolean
}

export function truncateCaption(content: string, max = 40): string {
  const trimmed = content.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

type AuthorRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function authorName(a: AuthorRef): string {
  const p = Array.isArray(a) ? (a[0] ?? null) : a
  return p?.display_name ?? p?.username ?? 'A player'
}

// Most recent posts (any post_type) that have an image, captioned by author +
// truncated content. No video overlay/duration badge — Sentinel X doesn't
// store video (spec §4.7); YouTube embeds live only on Match Centre.
//
// Fetches limit+1 to detect hasMore without a separate count query — same
// trick as fetchFeedPage.
export async function fetchCommunityGallery(offset: number, limit = 8): Promise<GalleryPage> {
  const supabase = createClient()
  const { data } = await supabase
    .from('community_posts')
    .select('id, content, image_url, author:profiles!community_posts_author_id_fkey(display_name, username)')
    .eq('is_deleted', false)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  const rows = data ?? []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      imageUrl: row.image_url as string,
      caption: truncateCaption(row.content),
      authorName: authorName(row.author as AuthorRef),
    })),
    hasMore,
  }
}
