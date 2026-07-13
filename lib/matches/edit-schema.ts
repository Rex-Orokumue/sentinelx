import { z } from 'zod'
import { parseYouTubeId } from './youtube'

const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
])

const localDate = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
])

// YouTube-only: the Match Centre video section (app/(public)/matches/[id]/page.tsx)
// embeds these via parseYouTubeId. If this ever accepts non-YouTube (e.g. a Drive
// link), update the Match Centre embed in the SAME change — otherwise it silently
// shows "no stream/replay".
const youtubeUrl = z.union([
  z.literal(''),
  z.string().trim().refine((v) => parseYouTubeId(v) !== null, 'Enter a valid YouTube link'),
])

export const matchEditSchema = z.object({
  schedulingMode: z.enum(['timed', 'full_day']),
  scheduledAt: localDateTime,
  scheduledDate: localDate,
  streamUrl: youtubeUrl,
  replayUrl: youtubeUrl,
})

export type MatchEditInput = z.infer<typeof matchEditSchema>
