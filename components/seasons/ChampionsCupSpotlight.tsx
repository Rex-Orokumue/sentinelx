import { Trophy } from 'lucide-react'

export function ChampionsCupSpotlight({ seasonEndLabel }: { seasonEndLabel: string }) {
  return (
    <section className="rounded-xl border border-sx-amber/30 bg-sx-amber/5 p-6 text-center">
      <Trophy className="mx-auto mb-2 h-6 w-6 text-sx-amber" />
      <p className="text-xs font-bold uppercase tracking-widest text-sx-amber">The Ultimate Prize</p>
      <h2 className="mt-1 font-display text-2xl font-black text-white">SentinelX Champions Cup</h2>
      <p className="mt-1 text-sm text-sx-gray">{seasonEndLabel}</p>
      <p className="mt-3 text-sm font-semibold text-white">1st ₦50,000 · 2nd ₦30,000 · 3rd ₦20,000</p>
      <p className="mt-2 text-xs text-sx-gray">Top 16 of the season earn an invitation.</p>
    </section>
  )
}
