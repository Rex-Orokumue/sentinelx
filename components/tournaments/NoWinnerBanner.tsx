// Leads a tournament that was closed with its final left undecided, so a
// visitor sees why there is no champion instead of an unexplained gap.
export function NoWinnerBanner() {
  return (
    <section className="mb-6 rounded-2xl border border-slate-700 bg-sx-surface p-6">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Result</p>
      <p className="font-display text-xl font-black uppercase leading-tight text-white">No winner declared</p>
      <p className="mt-1.5 text-sm text-sx-gray">
        The final ended in an unresolved dispute, so this tournament was closed without a champion. All other
        placements stand.
      </p>
    </section>
  )
}
