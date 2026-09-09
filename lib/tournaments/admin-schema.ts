import { z } from 'zod'

const optionalText = (max: number) => z.union([z.literal(''), z.string().trim().max(max)])
const optionalUrl = z.union([z.literal(''), z.string().trim().url('Enter a valid URL')])
// <input type="datetime-local"> yields 'YYYY-MM-DDTHH:mm' (no seconds/offset).
const localDateTime = z.union([
  z.literal(''),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time'),
])
const money = (max: number) =>
  z.coerce.number().int('Whole naira only').min(0, 'Cannot be negative').max(max, 'Amount is too large')

export const tournamentSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120, 'Title is too long'),
    gameId: z.string().uuid('Choose a game'),
    slug: z.union([z.literal(''), z.string().trim().max(120)]),
    description: optionalText(2000),
    bannerUrl: optionalUrl,
    cardImageUrl: optionalUrl,
    registrationFee: money(1_000_000),
    prizePool: money(1_000_000_000),
    maxPlayers: z.union([
      z.literal(''),
      z.coerce.number().int().min(2, 'At least 2 players').max(64, 'At most 64 players'),
    ]),
    registrationStart: localDateTime,
    registrationEnd: localDateTime,
    tournamentStart: localDateTime,
    tournamentEnd: localDateTime,
    rules: optionalText(5000),
    dataSupportText: optionalText(500),
    dataSupportWhatsapp: optionalText(20),
    tournamentType: z.enum(['open', 'community_club', 'masters', 'champions_cup']),
    seasonId: z.union([z.literal(''), z.string().uuid()]),
    format: z.enum(['group_knockout', 'round_robin']).default('group_knockout'),
    // Distinct from `format` above, which is the head-to-head SHAPE
    // (group_knockout / round_robin). This is which engine runs at all.
    competitionFormat: z.enum(['head_to_head', 'points_race']).default('head_to_head'),
    entryUnit: z.enum(['solo', 'squad']).default('solo'),
    squadSize: z.union([z.literal(''), z.coerce.number().int().min(2).max(6)]).default(''),
    manualKnockoutPairing: z
      .union([z.literal('true'), z.literal('false'), z.literal(''), z.boolean()])
      .transform((v) => v === true || v === 'true')
      .default(false),
    prizeSecond: z.union([z.literal(''), money(1_000_000_000)]).default(''),
    prizeThird: z.union([z.literal(''), money(1_000_000_000)]).default(''),
  })
  .refine((d) => d.tournamentType === 'open' || d.seasonId !== '', {
    message: 'Choose a season for this tournament type.',
    path: ['seasonId'],
  })
  .refine((d) => d.entryUnit === 'solo' || d.squadSize !== '', {
    message: 'Enter how many players are in a squad.',
    path: ['squadSize'],
  })
  // Mirrors tournaments_squads_are_points_race. Caught here so the admin gets
  // a sentence instead of a Postgres constraint name.
  .refine((d) => d.competitionFormat === 'points_race' || d.entryUnit === 'solo', {
    message: 'Squads are only available for points-race tournaments.',
    path: ['entryUnit'],
  })

export type TournamentInput = z.infer<typeof tournamentSchema>
