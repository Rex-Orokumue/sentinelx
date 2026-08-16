import Link from 'next/link'
import { formatNaira, formatNairaCompact, formatCompactNumber } from '@/lib/format'

const chipClass =
  'flex items-center gap-1 rounded-full border border-sx-border bg-sx-surface px-2 py-1 text-[11px] font-bold text-white transition-colors hover:border-sx-purple/40 sm:px-3 sm:py-1.5 sm:text-xs'

// Two compact pills next to the notification bell — wallet (real Naira,
// withdrawable) and SX Coins (in-platform points, non-cash). Only rendered
// when logged in (SiteHeader gates that). Shown at every width — below
// `sm:` the header has no room for a fully grouped number next to the logo,
// bell, and hamburger, so each chip renders both a compact form ("₦24.5K")
// and the full form ("₦24,500"), and CSS (not JS) picks which one shows —
// both render server-side, so there's no hydration mismatch or layout flash.
export function BalanceChips({ walletBalance, coinBalance }: { walletBalance: number; coinBalance: number }) {
  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      <Link href="/dashboard/wallet" className={chipClass}>
        <span aria-hidden>👛</span>
        <span className="sm:hidden">{formatNairaCompact(walletBalance)}</span>
        <span className="hidden sm:inline">{formatNaira(walletBalance)}</span>
      </Link>
      <Link href="/store" className={chipClass}>
        <span aria-hidden>🪙</span>
        <span className="sm:hidden">{formatCompactNumber(coinBalance)}</span>
        <span className="hidden sm:inline">{coinBalance.toLocaleString()}</span>
      </Link>
    </div>
  )
}
