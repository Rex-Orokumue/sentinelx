import Image from 'next/image'
import Link from 'next/link'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export function CommunityHero() {
  const mascotUrl = findOptionalPublicImage('mascot', 'mascot-community')

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sx-purple/30 bg-gradient-to-br from-sx-purple/25 via-sx-surface to-sx-bg p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-sx-purple/25 blur-[80px]"
      />
      <div className="relative grid items-center gap-6 lg:grid-cols-[1fr_240px]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">Community</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
            One Community.
            <br />
            <span className="text-sx-purple-text">Many Champions.</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-sx-gray">
            Connect. Compete. Grow together. Sentinel X is more than gaming, it&apos;s a family.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
            >
              Join the Community
            </Link>
            <Link
              href="/community-rules"
              className="rounded-lg border border-sx-border px-5 py-2.5 text-sm font-bold text-white hover:border-sx-purple/40"
            >
              Community Rules
            </Link>
          </div>
        </div>

        {mascotUrl ? (
          <Image
            src={mascotUrl}
            alt="Sentinel X mascot"
            width={240}
            height={260}
            className="mx-auto hidden h-56 w-auto object-contain sm:block lg:mx-0 lg:h-full"
          />
        ) : (
          <ImagePlaceholder
            className="hidden h-56 sm:block lg:h-full"
            label={'Sentinel mascot — pointing-at-camera pose\n(public/mascot/mascot-community.png)'}
          />
        )}
      </div>
    </div>
  )
}
