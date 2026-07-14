import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { PlayerCard, type PlayerCardData } from '@/components/player/PlayerCard'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Players · SentinelX Esports',
  description: 'Browse and search Sentinel X players by username or name.',
  openGraph: {
    title: 'Players · SentinelX Esports',
    description: 'Browse and search Sentinel X players by username or name.',
    url: `${SITE_URL}/players`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

const PLAYER_COLS = 'username, display_name, avatar_url, sentinel_score, sentinel_tier'

export default async function PlayersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim()
  const supabase = createClient()

  let query = supabase
    .from('profiles')
    .select(PLAYER_COLS)
    .order('sentinel_score', { ascending: false })
    .limit(60)
  if (q) {
    // Escape ilike wildcards ("%"/"_") plus the characters that are
    // structural to PostgREST's `.or()` filter-list syntax (",", "(", ")")
    // so they can't widen the match or break/inject into the filter string.
    const escaped = q.replace(/[%_,()]/g, (c) => `\\${c}`)
    query = query.or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
  }
  const { data } = await query
  const players = (data ?? []) as PlayerCardData[]

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Players</h1>
      <form action="/players" className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by username or name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </form>
      {players.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No players found.
        </p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <PlayerCard key={p.username} player={p} />
          ))}
        </div>
      )}
    </div>
  )
}
