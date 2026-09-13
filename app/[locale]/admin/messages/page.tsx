import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { fetchDmReports } from '@/lib/messages/admin-query'
import { DmReportRow } from '@/components/admin/DmReportRow'

export const metadata: Metadata = { title: 'Messages · Admin · SentinelX' }

export default async function AdminMessagesPage() {
  await requireStaff()
  const reports = await fetchDmReports()

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-white">Reported conversations</h2>
      {reports.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No reports.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <DmReportRow key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  )
}
