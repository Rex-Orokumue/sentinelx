import Link from 'next/link'
import { Trophy, Users, TrendingUp, ShoppingCart, Gift, ShieldCheck } from 'lucide-react'

const FEATURES = [
  {
    icon: Trophy,
    title: 'Compete',
    body: 'Join exciting tournaments and win amazing prizes.',
    href: '/tournaments',
  },
  {
    icon: Users,
    title: 'Connect',
    body: 'Meet gamers, build teams, and grow your network.',
    href: '/community',
  },
  {
    icon: TrendingUp,
    title: 'Climb',
    body: 'Climb the leaderboards and become a legend.',
    href: '/rankings',
  },
  {
    icon: ShoppingCart,
    title: 'Shop',
    body: 'Buy, sell and trade gaming accounts and gear safely.',
    href: '/exchange',
  },
  {
    icon: Gift,
    title: 'Earn Rewards',
    body: 'Play, win and earn exclusive rewards.',
    href: '/tournaments',
  },
  {
    icon: ShieldCheck,
    title: 'Be Part of the Community',
    body: "This is more than gaming. It's a family.",
    href: '/community',
  },
] as const

export function FeatureGrid() {
  return (
    <section
      id="how-it-works"
      className="mb-10 scroll-mt-20 rounded-xl border border-sx-border bg-sx-surface p-4 sm:p-6"
    >
      <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {FEATURES.map(({ icon: Icon, title, body, href }) => (
          <Link
            key={title}
            href={href}
            className="rounded-lg p-2 text-center transition-colors hover:bg-white/[0.03]"
          >
            <Icon className="mx-auto mb-3 h-7 w-7 text-sx-purple-text" />
            <p className="mb-1 text-sm font-bold text-white">{title}</p>
            <p className="text-xs text-sx-gray">{body}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
