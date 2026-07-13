import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { ReferralQueueRow, type PendingReferralWithdrawal } from '@/components/admin/ReferralQueueRow'

export const metadata: Metadata = { title: 'Referrals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'Player'
}
function firstP(p: ProfileRef | ProfileRef[]): ProfileRef {
  return Array.isArray(p) ? p[0] ?? null : p
}
const RESOLVED_STATUS: Record<string, string> = {
  paid: 'text-emerald-400',
  rejected: 'text-red-400',
}

export default async function AdminReferralsPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('referral_withdrawal_requests')
      .select(
        'id, player_id, amount, bank_name, account_number, account_name, profiles(username, display_name)',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('referral_withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const rawQueue = ((queueData as unknown[] | null) ?? []) as {
    id: string
    player_id: string
    amount: number
    bank_name: string
    account_number: string
    account_name: string
    profiles: ProfileRef | ProfileRef[]
  }[]

  // Live-queried, not snapshotted — Samuel always sees current referral truth.
  const referrerIds = rawQueue.map((r) => r.player_id)
  const { data: referredData } =
    referrerIds.length > 0
      ? await supabase
          .from('referrals')
          .select('referrer_id, referred:profiles!referrals_referred_id_fkey(username, display_name)')
          .in('referrer_id', referrerIds)
      : { data: [] as { referrer_id: string; referred: ProfileRef | ProfileRef[] }[] }

  const referredByReferrer = new Map<string, string[]>()
  for (const row of (referredData ?? []) as { referrer_id: string; referred: ProfileRef | ProfileRef[] }[]) {
    const name = nameOf(firstP(row.referred))
    const list = referredByReferrer.get(row.referrer_id) ?? []
    list.push(name)
    referredByReferrer.set(row.referrer_id, list)
  }

  const queue: PendingReferralWithdrawal[] = rawQueue.map((r) => ({
    id: r.id,
    playerName: nameOf(firstP(r.profiles)),
    amount: r.amount,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    accountName: r.account_name,
    referredPlayers: referredByReferrer.get(r.player_id) ?? [],
  }))

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      status: w.status,
      adminNote: w.admin_note,
      resolvedAt: w.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-4 text-base font-bold text-white">Needs action</h2>
        {queue.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No referral withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <ReferralQueueRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Recently resolved</h2>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-bold text-white">{r.playerName}</p>
                  <p className="shrink-0 text-sm">
                    {formatNaira(r.amount)}{' '}
                    <span className={`font-semibold ${RESOLVED_STATUS[r.status] ?? 'text-slate-400'}`}>
                      {r.status}
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(r.resolvedAt) ?? ''}
                  {r.adminNote ? ` · ${r.adminNote}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
