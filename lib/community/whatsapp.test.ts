import { describe, it, expect } from 'vitest'
import { shareExcerpt, postShareUrl } from './whatsapp'
import type { PostView } from './feed-query'
import { SITE_URL } from '@/lib/seo/site'

describe('shareExcerpt', () => {
  it('returns short content unchanged', () => {
    expect(shareExcerpt('Great win today!')).toBe('Great win today!')
  })

  it('truncates long content with an ellipsis at the max length', () => {
    const long = 'a'.repeat(150)
    expect(shareExcerpt(long, 100)).toBe(`${'a'.repeat(100)}…`)
  })

  it('returns an empty string for empty/whitespace-only content (image-only posts)', () => {
    expect(shareExcerpt('   ')).toBe('')
    expect(shareExcerpt('')).toBe('')
  })
})

const BASE_POST: PostView = {
  id: 'post-1',
  postType: 'manual',
  content: 'Just hit a new personal best!',
  imageUrl: null,
  referenceId: null,
  isPinned: false,
  boostedUntil: null,
  createdAt: '2026-08-16T00:00:00Z',
  author: {
    id: 'p1',
    username: 'methio',
    displayName: 'Methio',
    avatarUrl: null,
    membershipTier: 'guardian',
    sentinelTier: 'trusted',
  },
  canDelete: false,
  canBoost: false,
  reactionCounts: { fire: 0, crown: 0, strong: 0, wow: 0 },
  myReaction: null,
  commentCount: 0,
  matchResult: null,
}

describe('postShareUrl', () => {
  it('includes a content excerpt for a manual post', () => {
    const url = postShareUrl(BASE_POST)
    const text = decodeURIComponent(url.split('text=')[1])
    expect(text).toContain('Just hit a new personal best!')
    expect(text).toContain('/community/post-1')
  })

  it('uses the 🏅 prefix for achievement posts', () => {
    const url = postShareUrl({ ...BASE_POST, postType: 'achievement' })
    const text = decodeURIComponent(url.split('text=')[1])
    expect(text).toContain('🏅')
  })

  it('falls back to a generic message for an image-only post with no text', () => {
    const url = postShareUrl({ ...BASE_POST, content: '' })
    const text = decodeURIComponent(url.split('text=')[1])
    expect(text).toBe(`Check this out on SentinelX: ${SITE_URL}/community/post-1`)
  })
})
