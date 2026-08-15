'use client'
import { useState } from 'react'
import { formatNaira } from '@/lib/format'

// Balance = wallets.balance directly — already net of any pending
// withdrawal debit (debitWallet subtracts at request time, not at payout).
// See plan Global Constraints for why this isn't "Total − Pending".
export function BalanceHeroCard({ balance, pendingWithdrawal }: { balance: number; pendingWithdrawal: number }) {
  const [hidden, setHidden] = useState(false)
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-sx-purple/50 bg-gradient-to-r from-sx-purple/30 via-sx-surface to-sx-purple/10 p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-6 h-40 w-40 rounded-full bg-sx-purple/20 blur-[60px]"
      />
      <div className="relative flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sx-gray">Total Balance</p>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          className="text-sx-gray hover:text-white"
          aria-label={hidden ? 'Show balance' : 'Hide balance'}
        >
          {hidden ? '🙈' : '👁'}
        </button>
      </div>
      <p className="relative mt-1 font-display text-5xl font-black text-white">
        {hidden ? '••••••' : formatNaira(balance)}
      </p>
      <span className="relative mt-2 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
        Available Balance
      </span>
      {pendingWithdrawal > 0 && (
        <p className="relative mt-2 text-sm text-amber-400">
          ⏳ {formatNaira(pendingWithdrawal)} pending withdrawal — processed within 24 hours
        </p>
      )}
    </div>
  )
}
