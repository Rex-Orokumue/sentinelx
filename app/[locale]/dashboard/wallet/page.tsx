import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { BalanceHeroCard } from '@/components/wallet/BalanceHeroCard'
import { QuickActionsRow } from '@/components/wallet/QuickActionsRow'
import { EarningsOverview } from '@/components/wallet/EarningsOverview'
import { RecentTransactionsList } from '@/components/wallet/RecentTransactionsList'
import { WalletSecurityBadges } from '@/components/wallet/WalletSecurityBadges'
import { RewardsProgressWidget } from '@/components/wallet/RewardsProgressWidget'
import { ReferralEarningsCard } from '@/components/wallet/ReferralEarningsCard'
import { WithdrawalStatusPanel } from '@/components/wallet/WithdrawalStatusPanel'
import { loadWalletOverview } from '@/lib/wallet/overview'
import { SITE_URL } from '@/lib/seo/site'
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
  // Balance, pending withdrawals, earnings, trend and recent rows come from the shared reader that
  // GET /api/mobile/v1/wallet also uses. A failed read is an error, not a misleading zero balance.
  const [overviewRes, profileRes, coinBalance, kycRes, referralsRes, referralCoinTxRes] = await Promise.all([
    loadWalletOverview(admin, user.id),
    admin.from('profiles').select('xp, kyc_verified, username').eq('id', user.id).maybeSingle(),
    getCoinBalance(admin, user.id),
    admin
      .from('player_kyc')
      .select('payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id).eq('status', 'converted'),
    admin.from('sx_coin_transactions').select('amount').eq('player_id', user.id).in('source', ['referral_reward', 'referral_milestone']),
  ])
  if (!overviewRes.ok) throw new Error('Could not load the wallet')
  const overview = overviewRes.value

  const referralCoinsEarned = ((referralCoinTxRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)
  const balance = overview.balance
  const pendingWithdrawalTotal = overview.pendingWithdrawal
  const recentTransactions = overview.recentTransactions
  const tournamentPrizeTrendPct = overview.earnings.tournamentPrizeTrendPct
  const mascotUrl = findOptionalPublicImage('mascot', 'mascot-wallet')

  const { data: coinTxRows } = await admin
    .from('sx_coin_transactions')
    .select('id, amount, source, description, created_at')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <>
      <CoinDisclaimerTooltip />
      <BalanceHeroCard balance={balance} pendingWithdrawal={pendingWithdrawalTotal} mascotUrl={mascotUrl} />
      <QuickActionsRow />
      <EarningsOverview
        tournamentPrize={overview.earnings.tournamentPrize}
        tournamentPrizeTrendPct={tournamentPrizeTrendPct}
        referral={overview.earnings.referral}
        bonus={overview.earnings.bonus}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsList transactions={recentTransactions} />
        </div>
        <WithdrawalStatusPanel
          linkedBankName={kycRes.data?.payout_bank_name ?? null}
          linkedAccountNumber={kycRes.data?.payout_account_number ?? null}
          linkedAccountName={kycRes.data?.payout_account_name ?? null}
          availableToWithdraw={balance}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ReferralEarningsCard
          referralLink={`${SITE_URL}/signup?ref=${profileRes.data?.username ?? ''}`}
          convertedReferrals={referralsRes.count ?? 0}
          totalCoinsEarned={referralCoinsEarned}
        />
        <RewardsProgressWidget xp={profileRes.data?.xp ?? 0} />
        <WalletSecurityBadges kycVerified={profileRes.data?.kyc_verified ?? false} />
      </div>
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
    </>
  )
}
