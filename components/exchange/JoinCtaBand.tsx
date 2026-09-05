import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, CheckCircle2, Star, UserCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatStatCount, type ExchangeStats } from '@/lib/exchange/stats'

export function JoinCtaBand({ stats, signedIn }: { stats: ExchangeStats; signedIn: boolean }) {
  // positiveFeedback arrives pre-formatted (a percentage or an em dash), so it
  // does not pass through formatStatCount.
  const items: { icon: LucideIcon; value: string; label: string }[] = [
    { icon: Users, value: formatStatCount(stats.happyGamers), label: 'Happy Gamers' },
    { icon: CheckCircle2, value: formatStatCount(stats.successfulTrades), label: 'Successful Trades' },
    { icon: UserCheck, value: formatStatCount(stats.verifiedSellers), label: 'Verified Sellers' },
    { icon: Star, value: stats.positiveFeedback, label: 'Positive Feedback' },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-12 lg:items-center lg:gap-8">
        {/* Mascot — mascot-home.png stands in until dedicated store artwork exists. */}
        <div className="relative mx-auto h-28 w-28 shrink-0 sm:h-32 sm:w-32 lg:col-span-2 lg:mx-0 lg:h-40 lg:w-full">
          <Image
            src="/mascot/mascot-home.png"
            alt=""
            fill
            sizes="(max-width: 1024px) 8rem, 10rem"
            className="object-contain"
          />
        </div>

        <div className="lg:col-span-6">
          <h2 className="text-lg font-black leading-tight text-white sm:text-xl">
            JOIN THOUSANDS OF GAMERS TRADING EVERY DAY
          </h2>
          <p className="mt-1 text-xs text-sx-gray sm:text-sm">
            Save more. Play more. Level up with Sentinel X Gaming Exchange.
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {items.map(({ icon: Icon, value, label }) => (
              <div key={label} className="flex items-center gap-2">
                <Icon className="h-5 w-5 shrink-0 text-sx-purple-text" />
                <div className="min-w-0">
                  <dt className="sr-only">{label}</dt>
                  <dd className="truncate text-lg font-black text-white">{value}</dd>
                  <p className="truncate text-[10px] text-sx-gray">{label}</p>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-2xl border border-sx-border bg-sx-bg p-5 lg:col-span-4">
          <p className="text-sm font-black text-white">Trade smart. Trade safe.</p>
          <p className="mt-1 text-xs text-sx-gray">Trade only on Sentinel X.</p>
          <Link
            href={signedIn ? '/exchange/new' : '/signup'}
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-sx-purple px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            Get Started Now
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  )
}
