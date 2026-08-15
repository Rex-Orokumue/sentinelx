import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { WalletPanel, type WalletRequestRow } from '@/components/dashboard/WalletPanel'
import { EarningsBreakdownPanel } from '@/components/dashboard/EarningsBreakdownPanel'
import { getEarningsBreakdown } from '@/lib/wallet/breakdown'
import { listBanks, type Bank } from '@/lib/paystack/server'

export const metadata: Metadata = {
  title: 'Wallet · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function DashboardWalletPage({
  searchParams,
}: {
  searchParams: { deposit?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet')

  const [walletRes, walletRequestsRes, kycRes, banks, earningsBreakdown] = await Promise.all([
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at')
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
    supabase
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
    getEarningsBreakdown(createAdminClient(), user.id),
  ])

  const kyc = kycRes.data
  const walletBalance = walletRes.data?.balance ?? 0
  const walletRequests = (walletRequestsRes.data ?? []) as WalletRequestRow[]
  const hasActive = walletRequests.some((w) => w.status === 'pending')
  const payoutAccount =
    kyc?.payout_bank_name && kyc?.payout_account_number && kyc?.payout_account_name
      ? { bankName: kyc.payout_bank_name, accountNumber: kyc.payout_account_number, accountName: kyc.payout_account_name }
      : null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Wallet</h1>
        <p className="mt-1 text-sm text-slate-400">Earnings, deposits, and prize withdrawals.</p>
      </div>

      {searchParams.deposit === 'paid' && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-400">
          🎉 Wallet funded — your balance is updated below.
        </div>
      )}
      {searchParams.deposit === 'failed' && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
          Payment was not completed. You can try again below.
        </div>
      )}

      <div className="mb-4">
        <EarningsBreakdownPanel breakdown={earningsBreakdown} />
      </div>
      <WalletPanel
        balance={walletBalance}
        requests={walletRequests}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
    </div>
  )
}
