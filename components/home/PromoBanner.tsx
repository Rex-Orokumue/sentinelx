import Link from 'next/link'

export interface PromoBannerData {
  imageUrl: string
  linkUrl: string
  title: string
}

// Renders nothing when there's no active banner — homepage layout is unaffected.
export function PromoBanner({ banner }: { banner: PromoBannerData | null }) {
  if (!banner) return null

  const isExternal = /^https?:\/\//.test(banner.linkUrl)

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={banner.imageUrl}
      alt={banner.title}
      className="w-full rounded-2xl border border-slate-800 object-cover"
    />
  )

  return (
    <section className="pt-6">
      {isExternal ? (
        <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" className="block">
          {image}
        </a>
      ) : (
        <Link href={banner.linkUrl} className="block">
          {image}
        </Link>
      )}
    </section>
  )
}
