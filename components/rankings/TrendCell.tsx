import type { Trend } from '@/lib/rankings/trend'

// 'flat' and 'new' both render a dash: a player who hasn't moved and one with no
// history yet look the same to the eye, though the distinction matters to
// trendFor. Until the snapshot cron has run on two separate days, every row is
// a dash — that's correct, not a missing value.
export function TrendCell({ trend }: { trend: Trend | undefined }) {
  if (!trend || trend.direction === 'new' || trend.direction === 'flat') {
    return <span className="text-sx-gray">—</span>
  }
  const up = trend.direction === 'up'
  return (
    <span className={up ? 'font-semibold text-sx-green' : 'font-semibold text-red-400'}>
      {up ? '▲' : '▼'} {trend.delta}
    </span>
  )
}
