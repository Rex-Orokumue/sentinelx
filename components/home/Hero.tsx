import Image from 'next/image'
import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
      {/* Subtle purple radial glow, bottom-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sx-purple/25 blur-[100px]"
      />
      <div className="relative px-6 py-12 sm:px-10 sm:py-16 lg:py-20 lg:pr-64 xl:pr-80">
        <div className="text-center lg:text-left">
          <span className="mb-5 inline-block rounded-full border border-sx-purple/30 bg-sx-surface px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-sx-purple-text">
            Nigeria&apos;s Home of Mobile Esports
          </span>
          <h1 className="font-display text-5xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Compete.
            <br />
            Conquer.
            <br />
            <span className="text-sx-purple-text">Become a Legend.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
            Join thousands of gamers, compete in epic tournaments, climb the leaderboards, and win
            amazing prizes.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-sx-purple px-7 py-3.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-colors hover:bg-sx-purple-light sm:w-auto"
            >
              Register Now <span aria-hidden>→</span>
            </Link>
            <Link
              href="/tournaments"
              className="w-full max-w-xs rounded-lg border border-sx-border px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:border-white/30 sm:w-auto"
            >
              Explore Tournaments
            </Link>
          </div>
        </div>
      </div>

      {/* Mascot — in-flow/centered below the fold on mobile, pinned to the hero's
          full height on the right at lg+ so it scales with the card, not the text. */}
      <div className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-4 lg:mx-0 lg:h-auto lg:w-64 lg:pb-0 xl:right-8 xl:w-80">
        <Image
          src="/mascot/mascot-home.png"
          alt="Sentinel, the Sentinel X mascot"
          fill
          priority
          sizes="(min-width: 1280px) 20rem, (min-width: 1024px) 16rem, 13rem"
          className="object-contain object-bottom"
        />
      </div>
    </section>
  )
}
