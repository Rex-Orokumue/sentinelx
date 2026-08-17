'use client'

import Image from 'next/image'
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { useCountUp } from '@/lib/home/useCountUp'

const HEX_GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg width='60' height='69' viewBox='0 0 60 69' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='0.8'%3E%3Cpolygon points='30,1 57,16 57,53 30,68 3,53 3,16'/%3E%3C/g%3E%3C/svg%3E\")"

export function Hero({
  playerCount,
  tournamentCount,
  prizesPaidOut,
}: {
  playerCount: number
  tournamentCount: number
  prizesPaidOut: number
}) {
  const players = useCountUp<HTMLSpanElement>(playerCount)
  const tournaments = useCountUp<HTMLSpanElement>(tournamentCount)
  const prizes = useCountUp<HTMLSpanElement>(prizesPaidOut)

  return (
    <section className="relative mb-10 overflow-hidden px-4 pb-10 pt-10 sm:px-6 lg:px-8 lg:pb-14 lg:pt-14">
      {/* Purple radial top, faint gold radial bottom-right — matches the mockup's hero::before */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 65% at 50% -5%, rgba(124,58,237,0.22) 0%, transparent 65%), ' +
            'radial-gradient(ellipse 50% 40% at 95% 105%, rgba(245,158,11,0.07) 0%, transparent 55%)',
        }}
      />
      {/* Hex grid texture — matches the mockup's hero::after */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{ backgroundImage: HEX_GRID_BG, backgroundSize: '60px 69px' }}
      />

      <div className="relative flex flex-col items-center gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl text-center lg:text-left">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-sx-purple/30 bg-sx-purple/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-sx-purple-text">
            🇳🇬 Nigeria&apos;s #1 Mobile Esports Platform
          </span>

          <h1 className="font-display text-6xl font-black uppercase leading-[0.93] tracking-tight text-white sm:text-7xl lg:text-8xl">
            <span className="block">Nigeria&apos;s</span>
            <span className="block">Home of</span>
            <span className="block text-sx-purple-text">Mobile Esports</span>
          </h1>

          <p className="mx-auto mt-5 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
            Compete in tournaments, climb the rankings, and win real money — all on your
            phone. Nigeria&apos;s most trusted mobile esports platform.
          </p>

          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/tournaments"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-sx-purple px-7 py-3.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-colors hover:bg-sx-purple-light sm:w-auto"
            >
              🎮 Enter a Tournament
            </Link>
            <Link
              href="/rankings"
              className="w-full max-w-xs rounded-lg border border-white/20 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:border-white/40 sm:w-auto"
            >
              View Rankings →
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-8 border-t border-sx-border pt-6 lg:justify-start">
            <div>
              <span ref={players.ref} className="block font-display text-3xl font-black leading-none text-white">
                {players.value}+
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Registered Players
              </span>
            </div>
            <div>
              <span ref={prizes.ref} className="block font-display text-3xl font-black leading-none text-sx-amber">
                {formatNaira(prizes.value)}+
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Prizes Paid Out
              </span>
            </div>
            <div>
              <span ref={tournaments.ref} className="block font-display text-3xl font-black leading-none text-white">
                {tournaments.value}
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Tournaments Run
              </span>
            </div>
          </div>
        </div>

        {/* Mascot — kept in-scene (established brand identity), in-flow below the
            fold on mobile, pinned to the hero's bottom-right at lg+. */}
        <div className="relative h-56 w-44 shrink-0 sm:h-72 sm:w-56 lg:h-96 lg:w-72">
          <Image
            src="/mascot/mascot-home.png"
            alt="Sentinel, the Sentinel X mascot"
            fill
            priority
            sizes="(min-width: 1024px) 18rem, (min-width: 640px) 14rem, 11rem"
            className="object-contain object-bottom"
          />
        </div>
      </div>
    </section>
  )
}
