import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  BadgeCheck,
  Headphones,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const TRUST_PILLS: { icon: LucideIcon; title: string; sub: string }[] = [
  { icon: BadgeCheck, title: 'Verified Sellers', sub: '100% Verified' },
  { icon: ShieldCheck, title: 'Safe Trades', sub: 'Escrow Protection' },
  { icon: Tag, title: 'Best Prices', sub: 'Compare & Save' },
  { icon: Headphones, title: '24/7 Support', sub: "We've got you" },
]

const PERKS: { icon: LucideIcon; label: string }[] = [
  { icon: Sparkles, label: 'Find epic deals' },
  { icon: ShieldCheck, label: 'Trade safely' },
  { icon: Rocket, label: 'Level up your game' },
]

export function ExchangeHero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-sx-border bg-sx-surface px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      {/* Purple wash behind the mascot, matching the mockup's hero glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(circle_at_60%_50%,rgba(124,58,237,0.25),transparent_70%)]"
      />

      <div className="relative grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-6">
        {/* Copy */}
        <div className="lg:col-span-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sx-purple-text">
            Gaming Exchange
          </p>

          <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="block text-white">BUY. SELL. TRADE.</span>
            <span className="block text-sx-purple-text">PLAY MORE.</span>
          </h1>

          <p className="mt-4 max-w-md text-sm text-sx-gray sm:text-base">
            The most trusted marketplace for gamers.
            <br />
            Accounts, coins, gift cards &amp; more – all in one place.
          </p>

          <ul className="mt-6 grid grid-cols-2 gap-3 sm:max-w-lg lg:grid-cols-4">
            {TRUST_PILLS.map(({ icon: Icon, title, sub }) => (
              <li key={title} className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sx-purple/20 text-sx-purple-text">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-white">{title}</span>
                  <span className="block truncate text-[10px] text-sx-gray">{sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#featured-listings"
              className="flex items-center justify-center gap-2 rounded-xl bg-sx-purple px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
            >
              <ShoppingBag className="h-4 w-4" />
              Browse Listings
            </Link>
            <Link
              href="/exchange/new"
              className="flex items-center justify-center gap-2 rounded-xl border border-sx-border bg-sx-bg px-6 py-3 text-sm font-bold text-white transition-colors hover:border-sx-purple/50"
            >
              <Upload className="h-4 w-4" />
              Sell an Item
            </Link>
          </div>
        </div>

        {/* Mascot — mascot-games.png is the closest existing pose to the mockup's
            pointing gamer; swap when dedicated store artwork exists. */}
        <div className="relative order-first mx-auto h-40 w-40 sm:h-56 sm:w-56 lg:order-none lg:col-span-3 lg:h-72 lg:w-full">
          <Image
            src="/mascot/mascot-games.png"
            alt="Sentinel, the Sentinel X mascot"
            fill
            sizes="(max-width: 1024px) 14rem, 18rem"
            className="object-contain"
            priority
          />
        </div>

        {/* "Hey Gamer" card */}
        <aside className="rounded-2xl border border-sx-border bg-sx-bg p-5 lg:col-span-3">
          <p className="text-sm font-black text-white">Hey Gamer! 👋</p>

          <ul className="mt-4 space-y-3">
            {PERKS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-xs text-sx-gray">
                <Icon className="h-3.5 w-3.5 shrink-0 text-sx-purple-text" />
                {label}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-xs leading-relaxed text-sx-gray">
            All backed by <span className="font-bold text-sx-purple-text">ZOLARUX</span> ESCROW
            protection.
          </p>

          <Link
            href="/escrow"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-sx-purple px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            Learn More
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </aside>
      </div>
    </section>
  )
}
