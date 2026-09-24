import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { isMatchParticipant } from './participant'
import { canCheckIn, checkInVerdict, soleAttendee } from './check-in'
import { canMarkBothNoShow } from './noshow-eligibility'
import { wagerWindowOpen, estimateWagerPayout, WAGER_FEE_RATE, MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

export interface MatchCentreView {
  matchId: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  isParticipant: boolean
  canCheckIn: boolean
  checkedInPlayerIds: string[]
  checkInVerdict: 'both' | 'one' | 'none'
  soleAttendeeId: string | null
  wager: {
    windowOpen: boolean
    pools: { playerA: number; playerB: number }
    feeRate: number
    minStake: number
    maxStake: number
    myPickPlayerId: string | null
    myStakeCoins: number | null
    estimatedPayoutIfIStakeA100: number
  }
  noShowEligible: boolean
}

export async function buildMatchCentre(
  supabase: SupabaseClient<Database>,
  matchId: string,
  userId: string | null,
): Promise<MatchCentreView | null> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, is_full_day, player_a_id, player_b_id, team_a_id, team_b_id, noshow_flagged_at')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return null

  const isParticipant = userId ? await isMatchParticipant(supabase, userId, match) : false
  const dayReached = match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= Date.now()

  const { data: checkInRows } = await supabase.from('match_check_ins').select('player_id').eq('match_id', matchId)
  const checkedInPlayerIds = (checkInRows ?? []).map((r) => r.player_id)
  const alreadyCheckedIn = userId ? checkedInPlayerIds.includes(userId) : false
  const cis = {
    playerACheckedIn: match.player_a_id != null && checkedInPlayerIds.includes(match.player_a_id),
    playerBCheckedIn: match.player_b_id != null && checkedInPlayerIds.includes(match.player_b_id),
  }

  const { data: wagerRows } = await supabase.from('match_wagers').select('pick_player_id, stake_coins, bettor_id').eq('match_id', matchId)
  const pools = (wagerRows ?? []).reduce(
    (acc, w) => {
      if (w.pick_player_id === match.player_a_id) acc.playerA += w.stake_coins
      else if (w.pick_player_id === match.player_b_id) acc.playerB += w.stake_coins
      return acc
    },
    { playerA: 0, playerB: 0 },
  )
  const myWager = userId ? (wagerRows ?? []).find((w) => (w as { bettor_id?: string }).bettor_id === userId) : undefined

  const { count: submissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

  return {
    matchId: match.id,
    status: match.status,
    scheduledAt: match.scheduled_at,
    isFullDay: match.is_full_day,
    isParticipant,
    canCheckIn: canCheckIn({ isParticipant, dayReached, status: match.status, alreadyCheckedIn }),
    checkedInPlayerIds,
    checkInVerdict: checkInVerdict(cis),
    soleAttendeeId: soleAttendee(cis, match.player_a_id, match.player_b_id),
    wager: {
      windowOpen: wagerWindowOpen(match),
      pools,
      feeRate: WAGER_FEE_RATE,
      minStake: MIN_WAGER_STAKE,
      maxStake: MAX_WAGER_STAKE,
      myPickPlayerId: myWager?.pick_player_id ?? null,
      myStakeCoins: myWager?.stake_coins ?? null,
      estimatedPayoutIfIStakeA100: estimateWagerPayout(pools, 'player_a', 100),
    },
    noShowEligible: canMarkBothNoShow({
      status: match.status,
      noshowFlaggedAt: match.noshow_flagged_at,
      submissionCount: submissionCount ?? 0,
    }),
  }
}
