import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWalletBalance } from '@/lib/wallet/service'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { WithdrawForm } from '@/components/wallet/WithdrawForm'

export const metadata: Metadata = { title: 'Withdraw · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletWithdrawPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/withdraw')

  const admin = createAdminClient()
  const [balance, kycRes, activeRes] = await Promise.all([
    getWalletBalance(admin, user.id),
    admin
      .from('player_kyc')
      .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    admin.from('withdrawal_requests').select('id').eq('player_id', user.id).eq('status', 'pending').maybeSingle(),
  ])
  const kyc = kycRes.data
  const mode = kycPanelMode(kyc?.kyc_status ?? 'unverified')

  if (mode !== 'verified' || !kyc?.payout_bank_name) {
    return (
      <section className="rounded-2xl border border-sx-border bg-sx-surface p-5 text-center">
        <p className="font-bold text-white">Add a payout account before withdrawing</p>
        <p className="mt-1 text-sm text-sx-gray">You need a verified bank account on file to request a withdrawal.</p>
        <Link
          href="/dashboard/wallet/payment-methods"
          className="mt-4 inline-block rounded-xl bg-sx-purple px-6 py-3 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Add Payout Account
        </Link>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Request Withdrawal</h2>
      <div className="mb-4 rounded-xl border border-sx-border bg-sx-bg p-4 text-sm">
        <p className="text-xs uppercase tracking-wide text-sx-gray">Linked Bank Account</p>
        <p className="mt-1 text-white">
          🏦 {kyc.payout_bank_name} {maskAccountNumber(kyc.payout_account_number!)} — {kyc.payout_account_name}
        </p>
        <Link href="/dashboard/wallet/payment-methods" className="mt-1 inline-block text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          Change account →
        </Link>
      </div>
      <WithdrawForm balance={balance} hasActive={!!activeRes.data} />
      <p className="mt-4 text-xs text-sx-gray">
        🔒 Withdrawals are reviewed and processed within 24 hours. Funds go to your linked account above.
      </p>
    </section>
  )
}
