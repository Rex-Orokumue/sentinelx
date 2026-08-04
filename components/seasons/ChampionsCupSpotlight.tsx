export function ChampionsCupSpotlight({ seasonEndLabel }: { seasonEndLabel: string }) {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-400">The Ultimate Prize</p>
      <h2 className="mt-1 text-xl font-bold text-white">SentinelX Champions Cup</h2>
      <p className="mt-1 text-sm text-slate-400">{seasonEndLabel}</p>
      <p className="mt-3 text-sm font-semibold text-white">1st ₦50,000 · 2nd ₦30,000 · 3rd ₦20,000</p>
      <p className="mt-2 text-xs text-slate-500">Top 16 of the season earn an invitation.</p>
    </section>
  )
}
