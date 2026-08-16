'use server'
import { fetchCommunityGallery, type GalleryPage } from './gallery-query'

const PAGE_SIZE = 8

// "Load more" pagination for the Community Gallery — same Server Action
// pattern as loadMorePosts (lib/community/load-more-action.ts).
export async function loadMoreGalleryItems(offset: number): Promise<GalleryPage> {
  return fetchCommunityGallery(offset, PAGE_SIZE)
}
