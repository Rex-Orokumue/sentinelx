import type { GalleryItem } from '@/lib/community/gallery-query'

export function CommunityGallery({ items }: { items: GalleryItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Community Gallery</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-xl border border-sx-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.caption} className="h-28 w-full object-cover" />
            <div className="bg-sx-bg p-2">
              <p className="truncate text-[11px] font-semibold text-white">{item.caption}</p>
              <p className="text-[10px] text-sx-gray">By {item.authorName}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
