import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DepositForm } from '@/components/wallet/DepositForm'

export const metadata: Metadata = { title: 'Deposit · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletDepositPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/deposit')

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-white">Fund Your Wallet</h2>
      <p className="mb-4 text-sm text-sx-gray">Top up via Paystack — funds are available immediately after payment.</p>
      <DepositForm />
    </section>
  )
}
