import Link from 'next/link'

export interface ProfileImageGridItem {
  id: string
  imageUrl: string
}

// The single most recognisably "Instagram" element of the media-first feed
// (spec) — cropping to square here is fine, that's what a grid is for
// (unlike the feed card, which must letterbox).
export function ProfileImageGrid({ items }: { items: ProfileImageGridItem[] }) {
  if (items.length === 0) return null
  return (
    <section id="gallery" className="scroll-mt-24">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-white">Gallery</h2>
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl">
        {items.map((item) => (
          <Link key={item.id} href={`/community/${item.id}`} className="aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          </Link>
        ))}
      </div>
    </section>
  )
}
