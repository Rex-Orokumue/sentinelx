import { formatDateTime } from '@/lib/format'
import type { AdminRegistrationRow } from './RegistrationsTable'

// Waitlisted players get their own section rather than being mixed into the
// main registrations table — admin needs to find them at a glance (and their
// WhatsApp number) the moment a slot opens up.
export function WaitlistPanel({ rows }: { rows: AdminRegistrationRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-amber-400">
        Waitlist ({rows.length})
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Available as substitutes. Use &quot;Add substitute&quot; on a disqualified row to bring one in — their
        username autocompletes there.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-amber-500/30 bg-amber-500/[0.04]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-amber-500/20 text-[11px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2.5 text-left">Player</th>
              <th className="px-2 py-2.5 text-left">Username</th>
              <th className="px-2 py-2.5 text-left">WhatsApp</th>
              <th className="px-2 py-2.5 text-left">Club</th>
              <th className="px-3 py-2.5 text-left">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-amber-500/10 last:border-0">
                <td className="px-3 py-2.5 font-semibold text-white">
                  {r.regDisplayName ?? r.username ?? 'Unknown'}
                </td>
                <td className="px-2 py-2.5 text-slate-400">{r.username ?? '—'}</td>
                <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
