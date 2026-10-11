import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { maskAccountNumber, type PayoutAccountMasked } from '@/lib/kyc/logic'
import { mapTransactionRows, type RawWalletTxnRow, type WalletTxnRow } from './transactions'
import { summarizeEarningsByCategory } from './breakdown'
import { monthOverMonthChange } from './earnings-trend'

type Admin = SupabaseClient<Database>

export type { PayoutAccountMasked }

export interface WalletOverview {
  balance: number
  pendingWithdrawal: number
  earnings: { tournamentPrize: number; referral: number; bonus: number; tournamentPrizeTrendPct: number | null }
  recentTransactions: WalletTxnRow[]
  payoutAccount: PayoutAccountMasked | null
  kycVerified: boolean
  activeWithdrawal: { id: string; amount: number; requestedAt: string } | null
}

export type WalletOverviewResult = { ok: true; value: WalletOverview } | { ok: false; reason: 'load_failed' }

const RECENT_COUNT = 5

// The wallet screen's single read. Used by the web wallet page and GET /wallet. Every query is
// scoped to `playerId`; a failed read is reported, never shown as an empty wallet. Only the masked
// account number leaves this function.
export async function loadWalletOverview(admin: Admin, playerId: string, now: Date = new Date()): Promise<WalletOverviewResult> {
  const [walletRes, ledgerRes, withdrawalsRes, profileRes, kycRes] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle(),
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', playerId)
      .order('created_at', { ascending: false }),
    admin
      .from('withdrawal_requests')
      .select('id, amount, status, requested_at')
      .eq('player_id', playerId)
      .order('requested_at', { ascending: false }),
    admin.from('profiles').select('kyc_verified').eq('id', playerId).maybeSingle(),
    admin
      .from('player_kyc')
      .select('payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', playerId)
      .maybeSingle(),
  ])

  if (walletRes.error || ledgerRes.error || withdrawalsRes.error || profileRes.error || kycRes.error) {
    console.error('[wallet] overview read failed', {
      wallet: walletRes.error?.message,
      ledger: ledgerRes.error?.message,
      withdrawals: withdrawalsRes.error?.message,
      profile: profileRes.error?.message,
      kyc: kycRes.error?.message,
    })
    return { ok: false, reason: 'load_failed' }
  }

  const ledger = (ledgerRes.data ?? []) as RawWalletTxnRow[]
  const withdrawals = (withdrawalsRes.data ?? []) as { id: string; amount: number; status: string; requested_at: string }[]
  const pending = withdrawals.filter((w) => w.status === 'pending')
  const statusById = new Map(withdrawals.map((w) => [w.id, w.status]))
  const breakdown = summarizeEarningsByCategory(ledger)
  const kyc = kycRes.data

  return {
    ok: true,
    value: {
      balance: walletRes.data?.balance ?? 0,
      pendingWithdrawal: pending.reduce((sum, w) => sum + w.amount, 0),
      earnings: {
        tournamentPrize: breakdown.tournament_prize ?? 0,
        referral: breakdown.referral ?? 0,
        bonus: breakdown.bonus ?? 0,
        tournamentPrizeTrendPct: monthOverMonthChange(ledger, 'tournament_prize', now),
      },
      recentTransactions: mapTransactionRows(ledger.slice(0, RECENT_COUNT), statusById),
      payoutAccount:
        kyc?.payout_bank_name && kyc.payout_account_number && kyc.payout_account_name
          ? {
              bankName: kyc.payout_bank_name,
              accountName: kyc.payout_account_name,
              accountNumberMasked: maskAccountNumber(kyc.payout_account_number),
            }
          : null,
      kycVerified: profileRes.data?.kyc_verified ?? false,
      activeWithdrawal: pending[0] ? { id: pending[0].id, amount: pending[0].amount, requestedAt: pending[0].requested_at } : null,
    },
  }
}
