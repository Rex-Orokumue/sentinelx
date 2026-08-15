'use server'
import { createClient } from '@/lib/supabase/server'
import { fetchFeedPage, type FeedPage } from './feed-query'

const PAGE_SIZE = 20

// "Load more" pagination (spec §4) — a Server Action so the client feed list
// can fetch page N+1 without a full page navigation.
export async function loadMorePosts(offset: number): Promise<FeedPage> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return fetchFeedPage({ offset, limit: PAGE_SIZE, viewerId: user?.id ?? null })
}
