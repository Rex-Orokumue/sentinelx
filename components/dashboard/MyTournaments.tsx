import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'

export interface RegistrationRow {
  id: string
  paymentStatus: string
  tournamentTitle: string
  tournamentSlug: string
}

const PAYMENT: Record<string, { label: string; cls: string }> = {
  paid: { label: '✓ Paid', cls: 'text-emerald-400' },
  pending: { label: '● Payment pending', cls: 'text-amber-400' },
  refunded: { label: 'Refunded', cls: 'text-slate-400' },
}

export function MyTournaments({ registrations }: { registrations: RegistrationRow[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My tournaments</h2>
      {registrations.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="No registrations yet"
          body="Browse tournaments and register to compete."
        />
      ) : (
        <div className="space-y-2">
          {registrations.map((r) => (
            <RegistrationCard key={r.id} reg={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function RegistrationCard({ reg }: { reg: RegistrationRow }) {
  const p = PAYMENT[reg.paymentStatus] ?? { label: reg.paymentStatus, cls: 'text-slate-400' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <Link
          href={`/tournaments/${reg.tournamentSlug}`}
          className="block truncate font-bold text-white hover:text-violet-300"
        >
          {reg.tournamentTitle}
        </Link>
        <p className={`mt-0.5 text-xs font-semibold ${p.cls}`}>{p.label}</p>
      </div>
      {reg.paymentStatus === 'pending' && (
        <Link
          href={`/tournaments/${reg.tournamentSlug}`}
          className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          Complete registration →
        </Link>
      )}
    </div>
  )
}
