import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StatCard } from '@/components/admin/StatCard'
import { RecomputeButton } from '@/components/admin/RecomputeButton'
import { getAdminNotificationQueue, type AdminNotificationType } from '@/lib/admin/notification-queue'

export const metadata: Metadata = { title: 'Admin · SentinelX Esports' }

export default async function AdminHomePage() {
  const ctx = await requireStaff()
  const supabase = createClient()

  const [notifications, activeTournaments, openRegs] = await Promise.all([
    getAdminNotificationQueue(ctx.isAdmin ? 'admin' : 'moderator'),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('tournaments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'registration_open'),
  ])

  const countOf = (type: AdminNotificationType) => notifications.filter((n) => n.type === type).length
  const pendingResults = countOf('result_needs_review') + countOf('result_disputed')
  const pendingListings = countOf('exchange_listing_pending')
  const pendingWithdrawals = countOf('withdrawal_pending')

  return (
    <section>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Needs attention
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending results" count={pendingResults} href="/admin/results" />
        <StatCard label="Active tournaments" count={activeTournaments.count ?? 0} />
        <StatCard label="Open registrations" count={openRegs.count ?? 0} />
        <StatCard label="Pending listings" count={pendingListings} href="/admin/exchange" />
        {ctx.isAdmin && (
          <StatCard label="Pending withdrawals" count={pendingWithdrawals} href="/admin/wallet" />
        )}
      </div>

      {ctx.isAdmin && (
        <div className="mt-8">
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Maintenance
          </h2>
          <RecomputeButton />
        </div>
      )}
    </section>
  )
}
