import { ImageResponse } from 'next/og'
import { OG_SIZE } from './template'
import { resolveAvatarDataUri } from './avatar'
import { initialsFrom } from '@/lib/nav/tabs'

export interface PostCardOgInput {
  authorName: string
  authorUsername: string | null
  authorAvatarUrl: string | null
  authorTier: string | null
  content: string
  reactionCount: number
  commentCount: number
}

const TIER_ACCENT: Record<string, string> = {
  elite: '#22c55e',
  trusted: '#3b82f6',
  developing: '#eab308',
  at_risk: '#ef4444',
}

// Content truncation for the card body — longer than the feed's own
// truncateCaption (this card has more room), same "trim, slice, ellipsis"
// shape.
function excerpt(content: string, max = 180): string {
  const trimmed = content.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

export async function renderCommunityPostCard(input: PostCardOgInput) {
  const avatarDataUri = input.authorAvatarUrl ? await resolveAvatarDataUri(input.authorAvatarUrl) : null
  const accent = (input.authorTier && TIER_ACCENT[input.authorTier]) || '#7c3aed'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#020617',
          padding: '64px',
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>
          SENTINEL X COMMUNITY
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 44 }}>
          {avatarDataUri ? (
            <div
              style={{
                display: 'flex',
                width: 88,
                height: 88,
                borderRadius: '50%',
                backgroundImage: `url(${avatarDataUri})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: `3px solid ${accent}`,
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                width: 88,
                height: 88,
                borderRadius: '50%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#334155',
                color: '#ffffff',
                fontSize: 32,
                fontWeight: 700,
                border: `3px solid ${accent}`,
              }}
            >
              {initialsFrom(input.authorName, input.authorUsername)}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: '#ffffff' }}>{input.authorName}</div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 38,
            fontWeight: 600,
            color: '#ffffff',
            lineHeight: 1.35,
            marginTop: 36,
          }}
        >
          {excerpt(input.content)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 'auto', fontSize: 26, color: '#94a3b8' }}>
          <div style={{ display: 'flex' }}>🔥 {input.reactionCount}</div>
          <div style={{ display: 'flex' }}>💬 {input.commentCount}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
