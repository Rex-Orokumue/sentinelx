import type { Metadata } from 'next'
import Link from 'next/link'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { matchesPlayerQuery } from '@/lib/admin/search'

export const metadata: Metadata = { title: 'Players · Admin · SentinelX' }

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  await requireStaff()
  const admin = createAdminClient()
  const { data: players } = await admin
    .from('profiles')
    .select('id, username, display_name, sx_score, membership_tier, total_matches')
    .order('username')

  const q = searchParams.q ?? ''
  const filtered = (players ?? []).filter((p) =>
    matchesPlayerQuery({ username: p.username, displayName: p.display_name }, q),
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Players</h1>
      <form className="mb-6" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by username or display name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-slate-300">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Player</th>
              <th>SX Score</th>
              <th>Tier</th>
              <th>Matches</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-2">{p.display_name ?? p.username}</td>
                <td>{p.sx_score}</td>
                <td className="capitalize">{p.membership_tier}</td>
                <td>{p.total_matches}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/players/${p.id}`}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No players match &ldquo;{q}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
