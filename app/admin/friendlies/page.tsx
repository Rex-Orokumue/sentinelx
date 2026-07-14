import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { prefillScore } from '@/lib/matches/verify'
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
      'id, stake_amount, challenger_id, opponent_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .eq('status', 'awaiting_admin_confirmation')
    .order('created_at', { ascending: true })

  const matches = ((data as unknown[] | null) ?? []) as {
    id: string
    stake_amount: number | null
    challenger_id: string
    opponent_id: string
    challenger: ProfileRef
    opponent: ProfileRef
  }[]

  const admin = createAdminClient()
  const queue: PendingFriendlyMatch[] = await Promise.all(
    matches.map(async (m) => {
      const { data: subs } = await supabase
        .from('friendly_match_results')
        .select('submitted_by, score_challenger, score_opponent, screenshot_url')
        .eq('friendly_match_id', m.id)
        .order('created_at')
      const submissions = (subs ?? []) as {
        submitted_by: string
        score_challenger: number
        score_opponent: number
        screenshot_url: string
      }[]
      const withUrls = await Promise.all(
        submissions.map(async (s) => {
          const { data: signed } = await admin.storage
            .from('friendly-match-evidence')
            .createSignedUrl(s.screenshot_url, 3600)
          return {
            submittedBy: s.submitted_by === m.challenger_id ? ('challenger' as const) : ('opponent' as const),
            scoreChallenger: s.score_challenger,
            scoreOpponent: s.score_opponent,
            signedUrl: signed?.signedUrl ?? null,
          }
        }),
      )
      const s0 = submissions[0] ? { scoreA: submissions[0].score_challenger, scoreB: submissions[0].score_opponent } : null
      const s1 = submissions[1] ? { scoreA: submissions[1].score_challenger, scoreB: submissions[1].score_opponent } : null
      const prefill = prefillScore(s0, s1)
      return {
        id: m.id,
        challengerName: nameOf(m.challenger),
        opponentName: nameOf(m.opponent),
        stakeAmount: m.stake_amount,
        submissions: withUrls,
        prefillScoreChallenger: prefill?.scoreA ?? null,
        prefillScoreOpponent: prefill?.scoreB ?? null,
      }
    }),
  )

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
