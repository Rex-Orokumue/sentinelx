'use client'
import { useState } from 'react'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { formatDateTime } from '@/lib/format'

export interface AdminRegistrationRow {
  id: string
  username: string | null
  regDisplayName: string | null
  regWhatsapp: string | null
  regClubName: string | null
  regIgnTag: string | null
  paymentStatus: string
  registeredAt: string
}

export function RegistrationsTable({ rows }: { rows: AdminRegistrationRow[] }) {
  const [query, setQuery] = useState('')
  const filtered = rows.filter((r) =>
    matchesPlayerQuery(
      { username: r.username, displayName: r.regDisplayName, clubName: r.regClubName },
      query,
    ),
  )

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
                <th className="px-3 py-2.5 text-left">Registered</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-white">
                    {r.regDisplayName ?? r.username ?? 'Unknown'}
                  </td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regIgnTag ?? '—'}</td>
                  <td className="px-2 py-2.5 capitalize text-slate-300">{r.paymentStatus}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
