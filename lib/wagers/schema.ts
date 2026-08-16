import { z } from 'zod'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from './market'

export const placeWagerSchema = z.object({
  matchId: z.string().uuid('Invalid match.'),
  pickPlayerId: z.string().uuid('Invalid pick.'),
  stakeCoins: z.coerce
    .number()
    .int('Stake must be a whole number of coins.')
    .min(MIN_WAGER_STAKE, `Minimum stake is ${MIN_WAGER_STAKE} coins.`)
    .max(MAX_WAGER_STAKE, `Maximum stake is ${MAX_WAGER_STAKE.toLocaleString()} coins.`),
})
export type PlaceWagerInput = z.infer<typeof placeWagerSchema>
