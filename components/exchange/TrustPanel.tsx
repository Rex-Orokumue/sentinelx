import { BadgeCheck, Headphones, Shield, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const REASONS: { icon: LucideIcon; className: string; title: string; sub: string }[] = [
  {
    icon: ShieldCheck,
    className: 'text-sx-green',
    title: 'Zolarux Escrow',
    sub: '100% Secure Transactions',
  },
  {
    icon: BadgeCheck,
    className: 'text-sx-purple-text',
    title: 'Verified Sellers Only',
    sub: 'Every seller is verified',
  },
  {
    icon: Headphones,
    className: 'text-white',
    title: '24/7 Customer Support',
    sub: "We're here anytime",
  },
  {
    icon: Shield,
    className: 'text-sky-400',
    title: 'Buyer Protection',
    sub: 'Money back guarantee',
  },
]

export function TrustPanel() {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-xs font-black uppercase tracking-wider text-white">Why Gamers Trust Us</h2>
      <ul className="mt-4 space-y-4">
        {REASONS.map(({ icon: Icon, className, title, sub }) => (
          <li key={title} className="flex items-start gap-3">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-white">{title}</span>
              <span className="block text-[10px] text-sx-gray">{sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
