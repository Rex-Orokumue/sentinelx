import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { FriendlyQueueRow, type PendingFriendlyMatch } from '@/components/admin/FriendlyQueueRow'

export const metadata: Metadata = { title: 'Friendlies · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'Player'
}

export default async function AdminFriendliesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('friendly_matches')
    .select(
      'id, stake_amount, score_challenger, score_opponent, screenshot_url, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .eq('status', 'awaiting_admin_confirmation')
    .order('created_at', { ascending: true })

  const queue: PendingFriendlyMatch[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      stake_amount: number | null
      score_challenger: number | null
      score_opponent: number | null
      screenshot_url: string | null
      challenger: ProfileRef
      opponent: ProfileRef
    }
    return {
      id: m.id,
      challengerName: nameOf(m.challenger),
      opponentName: nameOf(m.opponent),
      stakeAmount: m.stake_amount,
      scoreChallenger: m.score_challenger,
      scoreOpponent: m.score_opponent,
      screenshotUrl: m.screenshot_url,
    }
  })

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Friendlies — awaiting confirmation</h2>
      {queue.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          Nothing awaiting confirmation.
        </p>
      ) : (
        <div className="space-y-2">
          {queue.map((req) => (
            <FriendlyQueueRow key={req.id} req={req} />
          ))}
        </div>
      )}
    </section>
  )
}
