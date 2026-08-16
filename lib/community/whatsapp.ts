import { SITE_URL } from '@/lib/seo/site'
import type { PostView } from './feed-query'

// Every post card / detail page gets a plain wa.me/?text= share link — no
// API, same pattern as the rest of the app (spec §12). Match result posts
// get a richer prefill; everything else carries an excerpt of the post's
// own content so the message itself previews what's being shared, not just
// the link (the link unfurl's OG card — app/(public)/community/[postId]/
// opengraph-image.tsx — carries the rest once WhatsApp fetches it).
export function postShareUrl(post: PostView): string {
  const link = `${SITE_URL}/community/${post.id}`
  const text =
    post.postType === 'match_result' && post.matchResult?.playerA && post.matchResult?.playerB
      ? matchResultShareText(post, link)
      : genericShareText(post, link)
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// Exported for testing — trims/truncates the post content into a one-line
// preview short enough to sit above the link in a WhatsApp message.
export function shareExcerpt(content: string, max = 100): string {
  const trimmed = content.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

function genericShareText(post: PostView, link: string): string {
  const excerpt = shareExcerpt(post.content)
  const prefix = post.postType === 'achievement' ? '🏅' : '📣'
  return excerpt
    ? `${prefix} "${excerpt}" — check it out on SentinelX: ${link}`
    : `Check this out on SentinelX: ${link}`
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
