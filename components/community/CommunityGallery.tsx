'use client'
import { useState, useTransition } from 'react'
import type { GalleryItem } from '@/lib/community/gallery-query'
import { loadMoreGalleryItems } from '@/lib/community/load-more-gallery-action'
import { ImageLightbox } from './ImageLightbox'

export function CommunityGallery({ initialItems, initialHasMore }: { initialItems: GalleryItem[]; initialHasMore: boolean }) {
  const [items, setItems] = useState(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, startTransition] = useTransition()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  function onLoadMore() {
    startTransition(async () => {
      const page = await loadMoreGalleryItems(items.length)
      setItems((prev) => [...prev, ...page.items])
      setHasMore(page.hasMore)
    })
  }

  if (items.length === 0) return null

  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Community Gallery</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightboxIndex(i)}
            className="overflow-hidden rounded-xl border border-sx-border text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.caption} className="h-28 w-full object-cover" />
            <div className="bg-sx-bg p-2">
              <p className="truncate text-[11px] font-semibold text-white">{item.caption}</p>
              <p className="text-[10px] text-sx-gray">By {item.authorName}</p>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={pending}
            className="rounded-lg border border-sx-border px-5 py-2 text-xs font-bold text-sx-gray hover:border-sx-purple/40 hover:text-sx-white disabled:opacity-50"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {lightboxIndex !== null && (
        <ImageLightbox
          urls={items.map((item) => item.imageUrl)}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  )
}
