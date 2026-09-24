'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { placeWagerSchema } from './schema'
import { performPlaceWager, type PlaceWagerErrorCode } from './place-wager-service'

export type WagerState = { error?: string; success?: boolean } | undefined

const PLACE_WAGER_MESSAGE: Record<PlaceWagerErrorCode, string> = {
  pending_deletion: 'Your account is pending deletion.',
  match_not_found: 'Match not found.',
  own_match: 'You cannot wager on your own match.',
  invalid_pick: 'Pick must be one of the two players in this match.',
  window_closed: 'Wagering is closed for this match.',
  insufficient_coins: 'Not enough SX Coins for this stake.',
  wager_failed: 'Could not place your wager. Please try again.',
}

export async function placeWager(_prev: WagerState, formData: FormData): Promise<WagerState> {
  const parsed = placeWagerSchema.safeParse({
    matchId: formData.get('matchId'),
    pickPlayerId: formData.get('pickPlayerId'),
    stakeCoins: formData.get('stakeCoins'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { matchId, pickPlayerId, stakeCoins } = parsed.data

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to place a wager.' }

  const result = await performPlaceWager(supabase, createAdminClient(), user.id, matchId, { pickPlayerId, stakeCoins })
  if (!result.ok) return { error: PLACE_WAGER_MESSAGE[result.errorCode] }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
