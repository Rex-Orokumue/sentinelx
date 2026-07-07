import { TierBadge } from '@/components/player/TierBadge'

export function AwardCard({
  label,
  icon,
  name,
  metricLabel,
  metricValue,
  tier,
}: {
  label: string
  icon: string
  name: string
  metricLabel: string
  metricValue: string | number
  tier?: string | null
}) {
  const initial = (name[0] ?? '?').toUpperCase()
  return (
    <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-violet-400/80">
        {icon} {label}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-700 text-base font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black leading-tight text-white">{name}</p>
          {tier !== undefined && <TierBadge tier={tier ?? null} />}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-2xl font-black text-white">{metricValue}</span>
        <span className="text-xs text-slate-400">{metricLabel}</span>
      </div>
    </div>
  )
}
