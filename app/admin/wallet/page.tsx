import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { WalletCreditForm } from '@/components/admin/WalletCreditForm'
import { WalletWithdrawalQueueRow, type PendingWalletWithdrawal } from '@/components/admin/WalletWithdrawalQueueRow'

export const metadata: Metadata = { title: 'Wallet · Admin · SentinelX' }

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

export default async function AdminWalletPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, profiles(username, display_name)',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const queue: PendingWalletWithdrawal[] = ((queueData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      bank_name: string
      account_number: string
      account_name: string
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountName: w.account_name,
    }
  })

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: r.id,
      playerName: nameOf(firstP(r.profiles)),
      amount: r.amount,
      status: r.status,
      adminNote: r.admin_note,
      resolvedAt: r.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <WalletCreditForm />

      <div>
        <h2 className="mb-4 text-base font-bold text-white">Needs action</h2>
        {queue.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <WalletWithdrawalQueueRow key={req.id} req={req} />
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
