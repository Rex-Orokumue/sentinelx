import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'

export const metadata: Metadata = { title: 'Referrals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'Player'
}
function firstP(p: ProfileRef | ProfileRef[]): ProfileRef {
  return Array.isArray(p) ? (p[0] ?? null) : p
}

export default async function AdminReferralsPage() {
  await requireAdmin()
  const admin = createAdminClient()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [totalRes, convertedRes, monthRes, coinsRes, allConvertedRes] = await Promise.all([
    admin.from('referrals').select('id', { count: 'exact', head: true }),
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'converted')
      .gte('converted_at', monthStart.toISOString()),
    admin.from('sx_coin_transactions').select('amount').in('source', ['referral_reward', 'referral_milestone']),
    admin
      .from('referrals')
      .select('referrer_id, profiles!referrals_referrer_id_fkey(username, display_name)')
      .eq('status', 'converted'),
  ])

  const totalCoinsDistributed = ((coinsRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)

  const countByReferrer = new Map<string, { name: string; count: number }>()
  for (const raw of (allConvertedRes.data ?? []) as unknown[]) {
    const row = raw as { referrer_id: string; profiles: ProfileRef | ProfileRef[] }
    const existing = countByReferrer.get(row.referrer_id)
    const name = nameOf(firstP(row.profiles))
    countByReferrer.set(row.referrer_id, { name, count: (existing?.count ?? 0) + 1 })
  }
  const topReferrers = Array.from(countByReferrer.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Total Referrals</p>
          <p className="font-display text-2xl font-black text-white">{totalRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Total Converted</p>
          <p className="font-display text-2xl font-black text-white">{convertedRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Converted This Month</p>
          <p className="font-display text-2xl font-black text-white">{monthRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Coins Distributed</p>
          <p className="font-display text-2xl font-black text-white">🪙 {totalCoinsDistributed.toLocaleString()}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-base font-bold text-white">Top 10 Referrers</h2>
        {topReferrers.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No conversions yet.</p>
        ) : (
          <div className="space-y-2">
            {topReferrers.map((r, i) => (
              <div key={`${r.name}-${i}`} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="font-bold text-white">
                  #{i + 1} {r.name}
                </p>
                <p className="text-sm text-slate-400">{r.count} converted</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
