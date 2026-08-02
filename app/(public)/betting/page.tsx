import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { bettingOpen } from '@/lib/betting/market'
import { buildMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Betting — Sentinel X',
  description: 'Bet on open Sentinel X matches.',
  path: '/betting',
})

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export default async function BettingHubPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, scheduled_at, betting_locked, status, ' +
        'tournaments(title), ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('status', 'scheduled')
    .not('player_a_id', 'is', null)
    .not('player_b_id', 'is', null)
    .order('scheduled_at')

  type Row = {
    id: string
    scheduled_at: string | null
    betting_locked: boolean
    status: string
    tournaments: { title: string } | null
    player_a: ProfileRef
    player_b: ProfileRef
  }
  const open = ((data ?? []) as unknown as Row[]).filter((m) => bettingOpen(m))

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-6">
      <h1 className="mb-4 text-xl font-black text-white">Open for betting</h1>
      {open.length === 0 ? (
        <p className="text-sm text-slate-500">No matches open for betting right now.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((m) => (
            <li key={m.id}>
              <Link
                href={`/matches/${m.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"
              >
                <p className="text-xs text-slate-500">{m.tournaments?.title ?? 'Sentinel X'}</p>
                <p className="text-sm font-bold text-white">
                  {nameOf(m.player_a)} vs {nameOf(m.player_b)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
