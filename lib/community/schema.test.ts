import { describe, it, expect } from 'vitest'
import { communityPostSchema, communityReplySchema } from './schema'

const validPost = {
  gameId: '11111111-1111-4111-8111-111111111111',
  body: 'Anyone up for a friendly before the weekend cup?',
}
const validReply = {
  postId: '22222222-2222-4222-8222-222222222222',
  body: "I'm in!",
}

describe('communityPostSchema', () => {
  it('accepts a valid post', () => {
    expect(communityPostSchema.safeParse(validPost).success).toBe(true)
  })
  it('rejects an empty body', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: '   ' }).success).toBe(false)
  })
  it('rejects a body over 2000 characters', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: 'x'.repeat(2001) }).success).toBe(false)
  })
  it('accepts a body at exactly 2000 characters', () => {
    expect(communityPostSchema.safeParse({ ...validPost, body: 'x'.repeat(2000) }).success).toBe(true)
  })
  it('rejects a non-uuid gameId', () => {
    expect(communityPostSchema.safeParse({ ...validPost, gameId: 'dls' }).success).toBe(false)
  })
})

describe('communityReplySchema', () => {
  it('accepts a valid reply', () => {
    expect(communityReplySchema.safeParse(validReply).success).toBe(true)
  })
  it('rejects an empty body', () => {
    expect(communityReplySchema.safeParse({ ...validReply, body: '' }).success).toBe(false)
  })
  it('rejects a body over 2000 characters', () => {
    expect(communityReplySchema.safeParse({ ...validReply, body: 'x'.repeat(2001) }).success).toBe(false)
  })
  it('rejects a non-uuid postId', () => {
    expect(communityReplySchema.safeParse({ ...validReply, postId: 'not-a-uuid' }).success).toBe(false)
  })
})
