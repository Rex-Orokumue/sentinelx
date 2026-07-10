import { z } from 'zod'
import { parseYouTubeId } from '@/lib/matches/youtube'

export const TV_CATEGORIES = ['highlight', 'interview', 'recap', 'best_goal'] as const
export type TvCategory = (typeof TV_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<TvCategory, string> = {
  highlight: 'Highlight',
  interview: 'Interview',
  recap: 'Recap',
  best_goal: 'Best Goal',
}

export const tvVideoSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title'),
  category: z.enum(TV_CATEGORIES),
  youtubeUrl: z.string().trim().refine((v) => parseYouTubeId(v) !== null, 'Enter a valid YouTube link'),
  description: z.union([z.literal(''), z.string().trim()]).optional(),
  thumbnailUrl: z.union([z.literal(''), z.string().trim().url('Enter a valid URL')]).optional(),
})

export type TvVideoInput = z.infer<typeof tvVideoSchema>
