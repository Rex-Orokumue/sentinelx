import { z } from 'zod'

const body2000 = z.string().trim().min(1, 'Write something first').max(2000, 'Keep it under 2000 characters')

export const communityPostSchema = z.object({
  gameId: z.string().uuid('Choose a game'),
  body: body2000,
  imageUrl: z.union([z.literal(''), z.string().trim().url('Invalid image URL')]).optional(),
})
export type CommunityPostInput = z.infer<typeof communityPostSchema>

export const communityReplySchema = z.object({
  postId: z.string().uuid('Missing post'),
  body: body2000,
})
export type CommunityReplyInput = z.infer<typeof communityReplySchema>
