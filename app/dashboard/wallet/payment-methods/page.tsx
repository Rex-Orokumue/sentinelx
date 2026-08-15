import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listBanks, type Bank } from '@/lib/paystack/server'
import { maskAccountNumber } from '@/lib/kyc/logic'
import { KycForm } from '@/components/dashboard/KycForm'
import { RemoveAccountButton } from '@/components/wallet/RemoveAccountButton'

export const metadata: Metadata = { title: 'Payment Methods · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletPaymentMethodsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/payment-methods')

  const admin = createAdminClient()
  const [kycRes, banks] = await Promise.all([
    admin
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
  ])
  const kyc = kycRes.data

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Payment Methods</h2>
      {kyc?.kyc_status === 'verified' && kyc.payout_bank_name ? (
        <div className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-4 text-sm">
          <div>
            <p className="text-white">
              🏦 {kyc.payout_bank_name} {maskAccountNumber(kyc.payout_account_number!)} — {kyc.payout_account_name}
            </p>
            <span className="text-xs font-semibold text-emerald-400">✅ Primary</span>
          </div>
          <RemoveAccountButton />
        </div>
      ) : (
        <KycForm banks={banks} failureReason={kyc?.kyc_failure_reason} />
      )}
    </section>
  )
}
