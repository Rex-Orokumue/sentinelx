import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchFollowers, fetchFollowerIds, type FollowListEntry } from '@/lib/follows/query'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import type { MembershipTier } from '@/lib/membership/tiers'

async function loadNamedProfile(username: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, deleted_at')
    .eq('username', username)
    .maybeSingle()
  if (!data || data.deleted_at) return null
  return data
}

export async function generateMetadata({ params }: { params: { username: string; locale: Locale } }): Promise<Metadata> {
  const p = await loadNamedProfile(params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  return buildMetadata({
    title: `${name}'s Followers — SentinelX Esports`,
    description: `Players following ${name} on Sentinel X.`,
    path: `/players/${p.username}/followers`,
    locale: params.locale,
  })
}

export default async function FollowersPage({ params }: { params: { username: string } }) {
  const p = await loadNamedProfile(params.username)
  if (!p) notFound()
  const name = p.display_name ?? p.username
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [followers, followerIds] = await Promise.all([
    fetchFollowers(p.id),
    user ? fetchFollowerIds(user.id) : Promise.resolve([] as string[]),
  ])
  const followsViewerIds = new Set(followerIds)

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
      <nav className="py-4 text-xs text-sx-gray">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-1.5">›</span>
        <Link href={`/players/${p.username}`} className="hover:text-white">{name}</Link>
        <span className="mx-1.5">›</span>
        <span className="text-white">Followers</span>
      </nav>
      <h1 className="mb-4 font-display text-xl font-black text-white">Followers</h1>
      {followers.length === 0 ? (
        <EmptyState icon="👥" title="No followers yet" body={`${name} doesn't have any followers yet.`} />
      ) : (
        <FollowList entries={followers} followsViewerIds={followsViewerIds} />
      )}
    </div>
  )
}

// followsViewerIds: ids of the people (among `entries`) who follow the
// current viewer back — drives the "Follows you" tag. Empty for a logged-out
// viewer or when viewing your own list.
function FollowList({ entries, followsViewerIds }: { entries: FollowListEntry[]; followsViewerIds: Set<string> }) {
  return (
    <ul className="divide-y divide-sx-border rounded-xl border border-sx-border bg-sx-surface">
      {entries.map((e) => (
        <li key={e.id}>
          <Link href={`/players/${e.username}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sx-bg">
            <HexAvatar
              src={e.avatarUrl}
              username={e.displayName ?? e.username ?? ''}
              tier={(e.membershipTier ?? 'recruit') as MembershipTier}
              size="sm"
            />
            <span className="truncate font-semibold text-white">{e.displayName ?? e.username}</span>
            {followsViewerIds.has(e.id) && (
              <span className="ml-auto shrink-0 rounded-full bg-sx-bg px-2 py-0.5 text-[10px] font-bold text-sx-gray">
                Follows you
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
