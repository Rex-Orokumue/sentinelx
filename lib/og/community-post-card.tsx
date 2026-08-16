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
  postImageUrl: string | null
}

const TIER_ACCENT: Record<string, string> = {
  elite: '#22c55e',
  trusted: '#3b82f6',
  developing: '#eab308',
  at_risk: '#ef4444',
}

// Content truncation for the card body — shorter when a post-image panel
// shares the row (less width to work with).
function excerpt(content: string, max: number): string {
  const trimmed = content.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

export async function renderCommunityPostCard(input: PostCardOgInput) {
  const [avatarDataUri, postImageDataUri] = await Promise.all([
    input.authorAvatarUrl ? resolveAvatarDataUri(input.authorAvatarUrl) : Promise.resolve(null),
    input.postImageUrl ? resolveAvatarDataUri(input.postImageUrl, { width: 460, height: 460 }) : Promise.resolve(null),
  ])
  const accent = (input.authorTier && TIER_ACCENT[input.authorTier]) || '#7c3aed'

  const avatarBlock = avatarDataUri ? (
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
  )

  const textColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>
        SENTINEL X COMMUNITY
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 44 }}>
        {avatarBlock}
        <div style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: '#ffffff' }}>{input.authorName}</div>
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: postImageDataUri ? 32 : 38,
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.35,
          marginTop: 36,
        }}
      >
        {excerpt(input.content, postImageDataUri ? 140 : 180)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 'auto', fontSize: 26, color: '#94a3b8' }}>
        <div style={{ display: 'flex' }}>🔥 {input.reactionCount}</div>
        <div style={{ display: 'flex' }}>💬 {input.commentCount}</div>
      </div>
    </div>
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: postImageDataUri ? 'row' : 'column',
          backgroundColor: '#020617',
          padding: '64px',
          gap: postImageDataUri ? 48 : 0,
        }}
      >
        {textColumn}
        {postImageDataUri && (
          <div
            style={{
              display: 'flex',
              width: 420,
              height: 420,
              borderRadius: 24,
              flexShrink: 0,
              backgroundImage: `url(${postImageDataUri})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '3px solid #1e293b',
            }}
          />
        )}
      </div>
    ),
    OG_SIZE,
  )
}
