import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StatCard } from '@/components/admin/StatCard'

export const metadata: Metadata = { title: 'Admin · SentinelX Esports' }

export default async function AdminHomePage() {
  const ctx = await requireStaff()
  const supabase = createClient()

  const [pendingResults, activeTournaments, openRegs, pendingWithdrawals] = await Promise.all([
    supabase.from('match_results').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'registration_open'),
    ctx.isAdmin
      ? supabase
          .from('withdrawal_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
      : Promise.resolve({ count: null as number | null }),
  ])

  return (
    <section>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Needs attention
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending results" count={pendingResults.count ?? 0} />
        <StatCard label="Active tournaments" count={activeTournaments.count ?? 0} />
        <StatCard label="Open registrations" count={openRegs.count ?? 0} />
        {ctx.isAdmin && (
          <StatCard label="Pending withdrawals" count={pendingWithdrawals.count ?? 0} />
        )}
      </div>
    </section>
  )
}
