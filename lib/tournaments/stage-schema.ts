import { z } from 'zod'

// Admins paste placement tables out of rulebooks, where they appear
// comma-separated, space-separated or both. Accepting all three is cheaper
// than teaching everyone one format.
//
// Returns null rather than a partial list: a half-read points table would
// score a real tournament wrongly while looking plausible — the same reasoning
// as parsePointsConfig in points-config.ts.
export function parsePlacementList(raw: string): number[] | null {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null

  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) return null
  return nums
}

// Ranges mirror the CHECK constraints in migration 20260909092000 so an admin
// sees a sentence instead of a Postgres constraint name.
export const stageSchema = z.object({
  name: z.string().trim().min(1, 'Name this stage').max(60, 'Stage name is too long'),
  roundsCount: z.coerce.number().int().min(1, 'At least 1 round').max(20, 'At most 20 rounds'),
  lobbySize: z.coerce.number().int().min(2, 'At least 2 per lobby').max(100, 'At most 100 per lobby'),
  advanceCount: z.coerce.number().int().min(1, 'At least 1 entrant must advance'),
  placementPoints: z.string().transform((v, ctx) => {
    const parsed = parsePlacementList(v)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Enter placement points as numbers, e.g. 12, 9, 8, 7' })
      return z.NEVER
    }
    return parsed
  }),
  perKill: z.coerce.number().int().min(0, 'Cannot be negative').max(100, 'Too large'),
})

export type StageInput = z.infer<typeof stageSchema>
