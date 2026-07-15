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

  const card = (
    <div className="mx-auto max-w-[220px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 transition-transform hover:scale-[1.02] sm:max-w-[260px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={banner.imageUrl} alt={banner.title} className="w-full object-cover" />
    </div>
  )

  return (
    <section className="pt-6 text-center">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-400">
        📢 Coming Up
      </p>
      {isExternal ? (
        <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" className="block">
          {card}
        </a>
      ) : (
        <Link href={banner.linkUrl} className="block">
          {card}
        </Link>
      )}
    </section>
  )
}
