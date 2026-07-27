import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { dedupeGamesByName } from '@/lib/games/dedupe'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export const metadata = buildMetadata({
  title: 'Games · SentinelX Esports',
  description:
    "Every game Sentinel X Esports supports — active tournaments today, and what's coming next.",
  path: '/games',
  image: DEFAULT_OG_IMAGE,
})

export default async function GamesPage() {
  const supabase = createClient()
  const { data: rawGames } = await supabase
    .from('games')
    .select('name, slug, icon_url, active, created_at')
    .order('created_at')
  const games = dedupeGamesByName(rawGames ?? [])

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <h1 className="mb-2 text-2xl font-black text-white">Games</h1>
      <p className="mb-8 text-sm text-slate-400">
        Sentinel X Esports is built for multiple games from day one. Here&apos;s what you can compete in
        today, and what&apos;s coming next.
      </p>
      {games.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No games listed yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) =>
            g.active ? (
              <Link
                key={g.name}
                href={`/tournaments?game=${g.slug}`}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center transition-colors hover:border-violet-500/40"
              >
                <p className="text-sm font-bold text-white">{g.name}</p>
                <p className="mt-1 text-xs text-violet-400">View tournaments →</p>
              </Link>
            ) : (
              <div
                key={g.name}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-center opacity-60"
              >
                <p className="text-sm font-bold text-slate-300">{g.name}</p>
                <p className="mt-1 text-xs text-slate-500">Coming soon</p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
