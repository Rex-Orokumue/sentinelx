import { z } from 'zod'

export const modeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  competitionFormat: z.enum(['head_to_head', 'points_race']),
})
export type ModeInput = z.infer<typeof modeSchema>

export const formatSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  entryUnit: z.enum(['solo', 'squad']),
  teamSize: z.coerce.number().int().min(1, 'Team size must be at least 1').max(6, 'Team size is at most 6'),
  available: z.boolean(),
})
export type FormatInput = z.infer<typeof formatSchema>

export const mapSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
})
export type MapInput = z.infer<typeof mapSchema>

export const matchRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
})
export type MatchRuleInput = z.infer<typeof matchRuleSchema>

export const matchTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  available: z.boolean(),
})
export type MatchTypeInput = z.infer<typeof matchTypeSchema>
