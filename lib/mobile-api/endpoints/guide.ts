import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { claimBattleReady, ClaimError, getQuests } from '@/lib/guide/service'

const step = z.object({
  key: z.enum(['profile_complete', 'first_tournament_entered', 'first_match_completed']),
  done: z.boolean(),
  // An enum, never a URL: the app maps it to a route, and an unknown value degrades to no link.
  target: z.enum(['edit_profile', 'tournaments', 'matches']),
})
const quest = z.object({
  id: z.literal('battle_ready'),
  steps: z.array(step),
  doneCount: z.number().int(),
  totalCount: z.literal(3),
  allComplete: z.boolean(),
  claimed: z.boolean(),
  reward: z.object({ xp: z.number().int(), coins: z.number().int() }),
})

export const getGuideQuestsEndpoint = defineEndpoint({
  operationId: 'getGuideQuests',
  method: 'GET',
  path: '/guide/quests',
  summary: "The signed-in player's guide quests with per-step progress, claim state and the reward (read from the achievements row).",
  auth: 'user',
  response: z.object({ quests: z.array(quest) }),
  handler: async ({ ctx }) => ({ quests: await getQuests(ctx.admin, ctx.userId) }),
})

const claimBody = z.object({ quest: z.literal('battle_ready') })

export const claimGuideBadgeEndpoint = defineEndpoint({
  operationId: 'claimGuideBadge',
  method: 'POST',
  path: '/guide/badge',
  summary:
    'Claim the Battle Ready badge reward. Re-verifies the quest server-side. Naturally idempotent: a retry returns alreadyClaimed true and never a second reward; a retry of an interrupted claim resumes only the missing award. Errors: quest_incomplete (409), claim_in_progress (409), reward_unavailable (503).',
  auth: 'user',
  body: claimBody,
  response: z.object({ claimed: z.literal(true), alreadyClaimed: z.boolean(), xp: z.number().int(), coins: z.number().int() }),
  handler: async ({ ctx }) => {
    try {
      return await claimBattleReady(ctx.admin, ctx.userId)
    } catch (e) {
      if (e instanceof ClaimError) {
        if (e.code === 'quest_incomplete') throw Errors.questIncomplete()
        if (e.code === 'claim_in_progress') throw Errors.claimInProgress()
        throw Errors.rewardUnavailable()
      }
      throw e
    }
  },
})
