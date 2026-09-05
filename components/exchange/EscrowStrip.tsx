import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'

const STEPS = [
  { n: 1, title: 'Buyer Pays', sub: 'Funds held securely' },
  { n: 2, title: 'You Deliver', sub: 'Item delivered' },
  { n: 3, title: 'Buyer Confirms', sub: 'You get paid' },
]

export function EscrowStrip() {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-sx-border bg-sx-surface px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 shrink-0 text-sx-green" />
        <div>
          <p className="text-sm font-black text-white">TRADE SAFE. TRADE SMART.</p>
          <p className="text-xs text-sx-gray">All transactions are protected by Zolarux Escrow.</p>
        </div>
      </div>

      <ol className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
        {STEPS.map((step, i) => (
          <li key={step.n} className="flex items-center gap-3 sm:gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sx-purple text-xs font-black text-white">
              {step.n}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-white">{step.title}</span>
              <span className="block text-[11px] text-sx-gray">{step.sub}</span>
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight
                aria-hidden
                className="ml-auto h-4 w-4 shrink-0 rotate-90 text-sx-border sm:ml-2 sm:rotate-0"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-7 w-7 shrink-0 text-sx-green" />
        <div>
          <p className="text-sm font-black text-white">100% SAFE</p>
          <p className="text-xs text-sx-gray">or Your Money Back</p>
        </div>
      </div>
    </section>
  )
}
