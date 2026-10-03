import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { groupGameInterestRows } from '@/lib/games/game-interest-segment'
import { fetchConsentingCountries, fetchGameInterestSegment } from '@/lib/games/game-interest-segment-query'
import { GameInterestExportButtons } from '@/components/admin/GameInterestExportButtons'

export const metadata: Metadata = { title: 'Game Interest · Admin · SentinelX' }

export default async function AdminGameInterestPage({
  searchParams,
}: {
  searchParams: { game?: string; country?: string }
}) {
  await requireAdmin()
  const admin = createAdminClient()
  const [{ data: games }, countries, rows] = await Promise.all([
    admin.from('games').select('id, name').order('name'),
    fetchConsentingCountries(admin),
    fetchGameInterestSegment(admin, { game: searchParams.game, country: searchParams.country }),
  ])
  const players = groupGameInterestRows(rows)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Game Interest</h1>
      <form className="mb-6 flex flex-wrap gap-3" method="get">
        <select name="game" defaultValue={searchParams.game ?? ''} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="">All games</option>
          {(games ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select name="country" defaultValue={searchParams.country ?? ''} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-white hover:border-slate-500">
          Filter
        </button>
      </form>

      <GameInterestExportButtons game={searchParams.game} country={searchParams.country} />

      <p className="mt-4 text-xs text-slate-500">
        {players.length} consenting {players.length === 1 ? 'player' : 'players'}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm text-slate-300">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Player</th>
              <th>Country</th>
              <th>WhatsApp</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-2">{p.name}</td>
                <td>{p.country ?? '—'}</td>
                <td>{p.whatsappNumber ?? '—'}</td>
                <td>{p.games}</td>
              </tr>
            ))}
            {players.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-500">
                  No consenting players match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
