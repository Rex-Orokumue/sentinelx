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
  })
  .refine((d) => d.tournamentType === 'open' || d.seasonId !== '', {
    message: 'Choose a season for this tournament type.',
    path: ['seasonId'],
  })

export type TournamentInput = z.infer<typeof tournamentSchema>
