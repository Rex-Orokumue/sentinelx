// A boost lasts 24 hours from purchase.
export const BOOST_DURATION_MS = 24 * 60 * 60 * 1000

// Whether a boost is still running.
//
// The comparison used to be written inline in three places — the feed's
// canBoost, PostCard's badge, and boostPost's "already boosted" guard — while
// the feed's *ordering* did not check expiry at all. It sorted by
// boosted_until with nullsFirst:false, so any non-null value outranked every
// unboosted post forever: a post boosted on 17 August was still pinned to the
// top of the feed three weeks later, badge long gone. One definition, used
// everywhere, so the badge and the ranking can never disagree again.
export function isBoostLive(boostedUntil: string | null, now: Date): boolean {
  if (!boostedUntil) return false
  const expiry = new Date(boostedUntil).getTime()
  if (Number.isNaN(expiry)) return false
  return expiry > now.getTime()
}
