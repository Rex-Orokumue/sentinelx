import Link from 'next/link'
import { formatNaira } from '@/lib/format'

// Two compact pills next to the notification bell — wallet (real Naira,
// withdrawable) and SX Coins (in-platform points, non-cash). Only rendered
// when logged in (SiteHeader gates that). Hidden below `sm:` — same
// breakpoint as the header's WhatsApp CTA — to avoid crowding the smallest
// screens; both balances are one tap away via /dashboard/wallet regardless.
export function BalanceChips({ walletBalance, coinBalance }: { walletBalance: number; coinBalance: number }) {
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <Link
        href="/dashboard/wallet"
        className="flex items-center gap-1 rounded-full border border-sx-border bg-sx-surface px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        <span aria-hidden>👛</span>
        {formatNaira(walletBalance)}
      </Link>
      <Link
        href="/store"
        className="flex items-center gap-1 rounded-full border border-sx-border bg-sx-surface px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        <span aria-hidden>🪙</span>
        {coinBalance.toLocaleString()}
      </Link>
    </div>
  )
}
