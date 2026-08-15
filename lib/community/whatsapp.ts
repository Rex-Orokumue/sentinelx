import { SITE_URL } from '@/lib/seo/site'
import type { PostView } from './feed-query'

// Every post card / detail page gets a plain wa.me/?text= share link — no
// API, same pattern as the rest of the app (spec §12). Match result posts
// get a richer prefill; everything else shares a generic "check this out".
export function postShareUrl(post: PostView): string {
  const link = `${SITE_URL}/community/${post.id}`
  const text =
    post.postType === 'match_result' && post.matchResult?.playerA && post.matchResult?.playerB
      ? matchResultShareText(post, link)
      : `Check this out on SentinelX: ${link}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

function matchResultShareText(post: PostView, link: string): string {
  const m = post.matchResult!
  const a = m.playerA!
  const b = m.playerB!
  const aName = a.displayName ?? a.username ?? 'Player A'
  const bName = b.displayName ?? b.username ?? 'Player B'
  const aScore = m.scoreA ?? 0
  const bScore = m.scoreB ?? 0
  const winner = aScore > bScore ? aName : bName
  const loser = aScore > bScore ? bName : aName
  const winnerScore = Math.max(aScore, bScore)
  const loserScore = Math.min(aScore, bScore)
  return (
    `🏆 ${winner} beat ${loser} ${winnerScore}-${loserScore} in the ${m.tournamentTitle}!\n` +
    `Watch the action: ${link}`
  )
}
