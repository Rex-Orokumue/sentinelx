import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BalanceHeroCard } from '@/components/wallet/BalanceHeroCard'
import { QuickActionsRow } from '@/components/wallet/QuickActionsRow'
import { EarningsOverview } from '@/components/wallet/EarningsOverview'
import { RecentTransactionsList } from '@/components/wallet/RecentTransactionsList'
import { WalletSecurityBadges } from '@/components/wallet/WalletSecurityBadges'
import { RewardsProgressWidget } from '@/components/wallet/RewardsProgressWidget'
import { mapTransactionRows, type RawWalletTxnRow } from '@/lib/wallet/transactions'
import { monthOverMonthChange } from '@/lib/wallet/earnings-trend'
import { summarizeEarningsByCategory } from '@/lib/wallet/breakdown'
import { getCoinBalance } from '@/lib/coins/service'
import { CoinDisclaimerTooltip } from '@/components/coins/CoinDisclaimerTooltip'

export const metadata: Metadata = {
  title: 'Wallet · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function WalletOverviewPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet')

  const admin = createAdminClient()
  const [walletRes, allTxnRes, pendingWithdrawalsRes, profileRes, coinBalance] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false }),
    admin.from('withdrawal_requests').select('id, amount, status').eq('player_id', user.id).eq('status', 'pending'),
    admin.from('profiles').select('xp, kyc_verified').eq('id', user.id).maybeSingle(),
    getCoinBalance(admin, user.id),
  ])

  const allTxnRows = (allTxnRes.data ?? []) as RawWalletTxnRow[]
  const pendingWithdrawalTotal = (pendingWithdrawalsRes.data ?? []).reduce((sum, r) => sum + r.amount, 0)

  // Every withdrawal-status lookup this page needs is for the player's own
  // rows — fetch withdrawal_requests statuses by id for the recent-5 slice only.
  const recentRaw = allTxnRows.slice(0, 5)
  const withdrawalRequestIds = recentRaw.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  const { data: wrRows } =
    withdrawalRequestIds.length > 0
      ? await admin.from('withdrawal_requests').select('id, status').in('id', withdrawalRequestIds)
      : { data: [] as { id: string; status: string }[] }
  const withdrawalStatusById = new Map((wrRows ?? []).map((r) => [r.id, r.status]))
  const recentTransactions = mapTransactionRows(recentRaw, withdrawalStatusById)

  const breakdown = summarizeEarningsByCategory(allTxnRows)
  const tournamentPrizeTrendPct = monthOverMonthChange(allTxnRows, 'tournament_prize', new Date())

  const { data: coinTxRows } = await admin
    .from('sx_coin_transactions')
    .select('id, amount, source, description, created_at')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <>
      <CoinDisclaimerTooltip />
      <BalanceHeroCard balance={walletRes.data?.balance ?? 0} pendingWithdrawal={pendingWithdrawalTotal} />
      <QuickActionsRow />
      <EarningsOverview
        tournamentPrize={breakdown.tournament_prize ?? 0}
        tournamentPrizeTrendPct={tournamentPrizeTrendPct}
        referral={breakdown.referral ?? 0}
        bonus={breakdown.bonus ?? 0}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsList transactions={recentTransactions} />
        </div>
        <div className="space-y-4">
          <RewardsProgressWidget xp={profileRes.data?.xp ?? 0} />
          <WalletSecurityBadges kycVerified={profileRes.data?.kyc_verified ?? false} />
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">SX Coins</p>
              <p className="font-display text-xl font-black text-white">🪙 {coinBalance.toLocaleString()}</p>
            </div>
            {(coinTxRows ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">No coin activity yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs text-slate-400">
                {(coinTxRows ?? []).map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{tx.description ?? tx.source.replace(/_/g, ' ')}</span>
                    <span className={tx.amount >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
