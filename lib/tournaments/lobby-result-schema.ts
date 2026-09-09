import { z } from 'zod'

// A player's own claim about one lobby. Bounds mirror what a lobby can
// physically produce: stages_lobby_range caps a lobby at 100 entrants, so a
// placement or kill count above that is a typo, not a result.
export const lobbyResultSchema = z.object({
  placement: z.coerce
    .number()
    .int('Placement must be a whole number')
    .min(1, 'Placement starts at 1')
    .max(100, 'Placement is too large'),
  kills: z.coerce
    .number()
    .int('Kills must be a whole number')
    .min(0, 'Kills cannot be negative')
    .max(100, 'That many kills is not possible'),
})

export type LobbyResultInput = z.infer<typeof lobbyResultSchema>
