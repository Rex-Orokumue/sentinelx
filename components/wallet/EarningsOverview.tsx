import Link from 'next/link'
import { formatNaira } from '@/lib/format'

interface EarningCard {
  key: string
  icon: string
  label: string
  amount: number
  locked: boolean
  trendPct: number | null
}

// Referral is live (see plan Global Constraints) — only 'community' has no
// real data source yet.
export function EarningsOverview({
  tournamentPrize,
  tournamentPrizeTrendPct,
  referral,
  bonus,
}: {
  tournamentPrize: number
  tournamentPrizeTrendPct: number | null
  referral: number
  bonus: number
}) {
  const cards: EarningCard[] = [
    { key: 'tournament_prize', icon: '🏆', label: 'Tournament Winnings', amount: tournamentPrize, locked: false, trendPct: tournamentPrizeTrendPct },
    { key: 'referral', icon: '👥', label: 'Referral Rewards', amount: referral, locked: false, trendPct: null },
    { key: 'community', icon: '🎁', label: 'Community Rewards', amount: 0, locked: true, trendPct: null },
    { key: 'bonus', icon: '💰', label: 'Cashback / Bonuses', amount: bonus, locked: false, trendPct: null },
  ]

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Earnings Overview</h2>
        <Link href="/dashboard/wallet/transactions" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View Earnings History →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className={`rounded-xl border border-sx-border bg-sx-surface p-4 ${c.locked ? 'opacity-50' : ''}`}>
            <p className="text-lg">{c.icon}</p>
            <p className="mt-1 font-display text-xl font-black text-white">{c.locked ? '—' : formatNaira(c.amount)}</p>
            <p className="text-xs text-sx-gray">{c.label}</p>
            {c.locked ? (
              <p className="mt-1 text-[11px] font-semibold text-sx-gray">Coming Soon</p>
            ) : c.trendPct != null ? (
              <p className={`mt-1 text-[11px] font-semibold ${c.trendPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {c.trendPct >= 0 ? '+' : ''}
                {c.trendPct}% vs last month
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
