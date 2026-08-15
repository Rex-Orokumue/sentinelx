import { z } from 'zod'

// Spec §3: content <= 500, no markdown/links (spam prevention) — enforced by
// the DB CHECK too; this is the friendly client-side message. Empty text is
// allowed here — a post can be image-only; createPost enforces "text or
// image, not neither" across both fields together (spec §6).
export const postContentSchema = z.string().trim().max(500, 'Keep it under 500 characters')
export type PostContentInput = z.infer<typeof postContentSchema>

// Spec §7: comment content <= 280.
export const commentContentSchema = z
  .string()
  .trim()
  .min(1, 'Write something first')
  .max(280, 'Keep it under 280 characters')
export type CommentContentInput = z.infer<typeof commentContentSchema>

export const REACTIONS = ['fire', 'crown', 'strong', 'wow'] as const
export type ReactionType = (typeof REACTIONS)[number]
export const reactionSchema = z.enum(REACTIONS)
