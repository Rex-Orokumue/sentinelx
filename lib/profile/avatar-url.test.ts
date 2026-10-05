import { describe, it, expect } from 'vitest'
import { isOwnAvatarUrl } from './avatar-url'

const SUPA = 'https://abc.supabase.co'
const UID = '11111111-1111-1111-1111-111111111111'

describe('isOwnAvatarUrl', () => {
  it('accepts a public object under the caller’s own folder', () => {
    expect(isOwnAvatarUrl(`${SUPA}/storage/v1/object/public/avatars/${UID}/a.webp`, UID, SUPA)).toBe(true)
  })
  it('rejects another user’s folder', () => {
    expect(isOwnAvatarUrl(`${SUPA}/storage/v1/object/public/avatars/22222222-2222-2222-2222-222222222222/a.webp`, UID, SUPA)).toBe(false)
  })
  it('rejects other hosts, other buckets, path tricks and non-https', () => {
    expect(isOwnAvatarUrl(`https://evil.example/storage/v1/object/public/avatars/${UID}/a.webp`, UID, SUPA)).toBe(false)
    expect(isOwnAvatarUrl(`${SUPA}/storage/v1/object/public/community-images/${UID}/a.webp`, UID, SUPA)).toBe(false)
    expect(isOwnAvatarUrl(`${SUPA}/storage/v1/object/public/avatars/${UID}/../x/a.webp`, UID, SUPA)).toBe(false)
    expect(isOwnAvatarUrl(`http://abc.supabase.co/storage/v1/object/public/avatars/${UID}/a.webp`, UID, SUPA)).toBe(false)
    expect(isOwnAvatarUrl('not a url', UID, SUPA)).toBe(false)
  })
})
