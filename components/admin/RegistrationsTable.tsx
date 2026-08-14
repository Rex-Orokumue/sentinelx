'use client'
import { useState } from 'react'
import Link from 'next/link'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { formatDateTime } from '@/lib/format'
import { RefundButton } from './RefundButton'
import { DisqualifyButton } from './DisqualifyButton'
import { SubstituteForm } from './SubstituteForm'

export interface AdminRegistrationRow {
  id: string
  playerId: string
  username: string | null
  regDisplayName: string | null
  regWhatsapp: string | null
  regClubName: string | null
  regIgnTag: string | null
  paymentStatus: string
  registeredAt: string
  status: string
  replacesRegistrationId: string | null
}

export function RegistrationsTable({
  rows,
  tournamentId,
  tournamentStatus,
  tournamentTitle,
  registrationFee,
  isAdmin,
  waitlistUsernames = [],
}: {
  rows: AdminRegistrationRow[]
  tournamentId: string
  tournamentStatus: string
  tournamentTitle: string
  registrationFee: number
  isAdmin: boolean
  // Passed in rather than derived from `rows` — waitlisted players render in
  // their own panel and are filtered out of this table, so they'd otherwise
  // be missing from the substitute autocomplete.
  waitlistUsernames?: string[]
}) {
  const [query, setQuery] = useState('')
  const filtered = rows.filter((r) =>
    matchesPlayerQuery(
      { username: r.username, displayName: r.regDisplayName, clubName: r.regClubName },
      query,
    ),
  )
  const showRefunds = tournamentStatus === 'cancelled'
  const substitutedIds = new Set(rows.map((r) => r.replacesRegistrationId).filter(Boolean) as string[])

  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No registrations match &quot;{query}&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2.5 text-left">Player</th>
                <th className="px-2 py-2.5 text-left">WhatsApp</th>
                <th className="px-2 py-2.5 text-left">Club</th>
                <th className="px-2 py-2.5 text-left">IGN / Tag</th>
                <th className="px-2 py-2.5 text-left">Payment</th>
                <th className="px-2 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Registered</th>
                {showRefunds && <th className="px-3 py-2.5 text-left">Refund</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-white">
                    <Link href={`/admin/players/${r.playerId}`} className="hover:text-violet-300 hover:underline">
                      {r.regDisplayName ?? r.username ?? 'Unknown'}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regIgnTag ?? '—'}</td>
                  <td className="px-2 py-2.5 capitalize text-slate-300">{r.paymentStatus}</td>
                  <td className="px-2 py-2.5">
                    {r.status === 'disqualified' ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-red-400">Disqualified</span>
                        {isAdmin && !substitutedIds.has(r.id) && (
                          <SubstituteForm
                            tournamentId={tournamentId}
                            disqualifiedRegistrationId={r.id}
                            waitlistUsernames={waitlistUsernames}
                          />
                        )}
                      </div>
                    ) : r.status === 'waitlisted' ? (
                      <span className="text-xs font-bold text-amber-400">Waitlisted</span>
                    ) : isAdmin ? (
                      <DisqualifyButton
                        registrationId={r.id}
                        tournamentId={tournamentId}
                        playerId={r.playerId}
                        tournamentTitle={tournamentTitle}
                      />
                    ) : (
                      <span className="text-xs capitalize text-slate-400">{r.status}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
                  {showRefunds && (
                    <td className="px-3 py-2.5">
                      {r.paymentStatus === 'refunded' ? (
                        <span className="text-xs font-bold text-emerald-400">Refunded ✓</span>
                      ) : r.paymentStatus === 'paid' ? (
                        <RefundButton
                          registrationId={r.id}
                          tournamentId={tournamentId}
                          playerId={r.playerId}
                          amount={registrationFee}
                          reason="Season 2 registration refund"
                        />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
