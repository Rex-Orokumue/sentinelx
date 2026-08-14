import { formatNaira } from '@/lib/format'

const CATEGORY_LABELS: Record<string, string> = {
  tournament_prize: 'Tournament Winnings',
  referral: 'Referral Rewards',
  community: 'Community Rewards',
  bonus: 'Cashback / Bonuses',
}
const CATEGORY_ORDER = ['tournament_prize', 'referral', 'community', 'bonus']

export function EarningsBreakdownPanel({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Earnings Breakdown</p>
      <div className="space-y-2">
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="flex items-center justify-between text-sm">
            <span className="text-sx-gray">{CATEGORY_LABELS[cat]}</span>
            <span className="font-semibold text-white">{formatNaira(breakdown[cat] ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
