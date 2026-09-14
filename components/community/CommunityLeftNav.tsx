import Link from 'next/link'
import { BarChart3, Crown, MessageCircle, Repeat, ShoppingBag, SquareStack, Trophy, Users } from 'lucide-react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { ViewerProfile } from './PostComposer'

// Facebook-style left rail — desktop only (`xl`, matching SiteHeader's own
// breakpoint for "everything fits"; see SiteHeader.tsx). This is the
// community page's own nav, not a site-wide shell, so it only needs to
// point at real existing routes — no new pages behind it.
const LINKS = [
  { label: 'Find Friends', href: '/dashboard/friends', icon: Users },
  { label: 'Tournaments', href: '/tournaments', icon: Trophy },
  { label: 'Rankings', href: '/rankings', icon: BarChart3 },
  { label: 'Exchange', href: '/exchange', icon: Repeat },
  { label: 'Store', href: '/store', icon: ShoppingBag },
  { label: 'Hall of Fame', href: '/hall-of-fame', icon: Crown },
] as const

export function CommunityLeftNav({ viewer }: { viewer: ViewerProfile | null }) {
  const name = viewer?.displayName ?? viewer?.username ?? 'You'
  const profileHref = viewer?.username ? `/players/${viewer.username}` : '/dashboard/profile'

  return (
    <div className="hidden xl:block">
      <nav className="space-y-1 rounded-2xl border border-sx-border bg-sx-surface p-2 xl:sticky xl:top-20">
        {viewer && (
          <Link
            href={profileHref}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5"
          >
            <HexAvatar
              src={viewer.avatarUrl}
              username={name}
              tier={viewer.membershipTier as MembershipTier}
              size="xs"
              frameUrl={viewer.frameUrl}
            />
            <span className="truncate text-sm font-bold text-white">{name}</span>
          </Link>
        )}
        <Link
          href="/community"
          aria-current="page"
          className="flex items-center gap-3 rounded-xl bg-sx-purple/15 px-2.5 py-2 text-sm font-semibold text-sx-purple-text"
        >
          <SquareStack className="h-5 w-5 shrink-0" aria-hidden />
          Feed
        </Link>
        <Link
          href="/messages"
          className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-sx-gray transition-colors hover:bg-white/5 hover:text-white"
        >
          <MessageCircle className="h-5 w-5 shrink-0" aria-hidden />
          Messages
        </Link>
        {LINKS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-sx-gray transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
