import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MatchRoom } from '@/components/friendly/MatchRoom'
import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'

export const metadata: Metadata = { title: 'Match Room · SentinelX' }

type ProfileRef =
  | { username: string | null; display_name: string | null; whatsapp_number: string | null }
  | { username: string | null; display_name: string | null; whatsapp_number: string | null }[]
  | null
function first(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}
function nameOf(p: ReturnType<typeof first>): string {
  return p?.display_name ?? p?.username ?? 'Player'
}

export default async function MatchRoomPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/dashboard/friendlies/${params.id}`)

  const { data: raw } = await supabase
    .from('friendly_matches')
    .select(
      'id, challenger_id, opponent_id, stake_amount, status, challenger_paid, opponent_paid, ' +
        'game_code, score_challenger, score_opponent, winner_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name, whatsapp_number), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name, whatsapp_number)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!raw) notFound()
  // Two profile FK embeds in one select exceed the type-level select parser
  // (a known gotcha in this codebase) — cast to an explicit row shape.
  const data = raw as unknown as {
    id: string
    challenger_id: string
    opponent_id: string
    stake_amount: number | null
    status: string
    challenger_paid: boolean
    opponent_paid: boolean
    game_code: string | null
    score_challenger: number | null
    score_opponent: number | null
    winner_id: string | null
    challenger: ProfileRef
    opponent: ProfileRef
  }
  if (user.id !== data.challenger_id && user.id !== data.opponent_id) notFound()

  const { data: myResultRow } = await supabase
    .from('friendly_match_results')
    .select('id')
    .eq('friendly_match_id', params.id)
    .eq('submitted_by', user.id)
    .maybeSingle()
  const mySubmitted = !!myResultRow
  const isWinner = data.winner_id === user.id

  const isChallenger = user.id === data.challenger_id
  const me = isChallenger ? first(data.challenger as ProfileRef) : first(data.opponent as ProfileRef)
  const opponent = isChallenger ? first(data.opponent as ProfileRef) : first(data.challenger as ProfileRef)
  const opponentWhatsappUrl = (() => {
    const num = opponent?.whatsapp_number ? toWhatsAppNumber(opponent.whatsapp_number) : null
    if (!num) return null
    return `https://wa.me/${num}?text=${encodeURIComponent("Hey! Let's coordinate our friendly match on Sentinel X")}`
  })()

  return (
    <div className="mx-auto max-w-lg px-4 pb-20 pt-6">
      <h1 className="mb-1 text-xl font-black text-white">Match Room</h1>
      <p className="mb-6 text-sm text-slate-400">
        {nameOf(me)} vs {nameOf(opponent)}
        {data.stake_amount ? ` · ₦${data.stake_amount} stake` : ' · Free friendly'}
      </p>
      <MatchRoom
        matchId={data.id}
        status={data.status}
        stakeAmount={data.stake_amount}
        isChallenger={isChallenger}
        challengerPaid={data.challenger_paid}
        opponentPaid={data.opponent_paid}
        gameCode={data.game_code}
        opponentWhatsappUrl={opponentWhatsappUrl}
        scoreChallenger={data.score_challenger}
        scoreOpponent={data.score_opponent}
        mySubmitted={mySubmitted}
        isWinner={isWinner}
      />
    </div>
  )
}
