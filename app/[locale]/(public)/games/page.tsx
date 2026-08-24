import Link from 'next/link'
import Image from 'next/image'
import { Gamepad2, Trophy, Users, Gift, ShieldCheck, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { dedupeGamesByName } from '@/lib/games/dedupe'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { GameGenreTabs } from '@/components/games/GameGenreTabs'
import { NotifyMeButton } from '@/components/games/NotifyMeButton'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export const metadata = buildMetadata({
  title: 'Games · SentinelX Esports',
  description:
    "Every game Sentinel X Esports supports — active tournaments today, and what's coming next.",
  path: '/games',
  image: DEFAULT_OG_IMAGE,
})

// Real DB category taxonomy is football / fighting / shooter / racing / other
// (see supabase/migrations/027_multi_game_categories.sql + 065_racing_category.sql)
// — the mockup's wider genre set (Battle Royale, Strategy, Adventure) is
// gated behind roadmap #21 "multi-game support" and isn't real data yet, so
// those tabs aren't shown here rather than being dead filters with no matches.
const GENRES: { key: string; label: string }[] = [
  { key: 'all', label: '🎮 All Games' },
  { key: 'football', label: '⚽ Sports' },
  { key: 'shooter', label: '🔫 Shooter' },
  { key: 'fighting', label: '🥊 Fighting' },
  { key: 'racing', label: '🏎️ Racing' },
  { key: 'other', label: '🎲 Other' },
]

// Flavor copy — presentation only, keyed by game name. Falls back to a generic
// line built from the genre for anything not in this list.
const DESCRIPTIONS: Record<string, string> = {
  'Dream League Soccer': 'Build your dream team and compete against the best.',
  'DLS': 'Build your dream team and compete against the best.',
  'Call of Duty Mobile': 'Fast-paced action. Squad up and dominate the battlefield.',
  'COD Mobile': 'Fast-paced action. Squad up and dominate the battlefield.',
  'EA FC Mobile': 'Take control on the pitch and compete for glory.',
  'eFootball': 'Control. Strategy. Victory. This is eFootball.',
  'PUBG Mobile': 'Survive. Loot. Conquer. Be the last one standing.',
  'Free Fire': "10-minute battles. Non-stop action. Booyah your way to the top.",
  'Mortal Kombat Mobile': 'Fight, finish, and climb the ranks in this classic brawler.',
  'Asphalt': 'Floor it. High-speed multiplayer racing, no brakes allowed.',
}

const FALLBACK_BY_CATEGORY: Record<string, string> = {
  football: 'The beautiful game, on the go. Prove your football IQ.',
  fighting: 'Fast reflexes, sharp combos — prove you\'re the best fighter.',
  shooter: 'Squad up and dominate the battlefield.',
  racing: 'Floor it. Drift, boost, and cross the line first.',
  other: 'Compete for glory in this arena.',
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: { genre?: string; q?: string }
}) {
  const supabase = createClient()
  const genre = searchParams.genre?.trim() || 'all'
  const q = searchParams.q?.trim().toLowerCase() || ''

  const [{ data: rawGames }, { count: tournamentCount }, { count: playerCount }] = await Promise.all([
    supabase.from('games').select('id, name, slug, icon_url, active, category, created_at').order('created_at'),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
  ])

  let games = dedupeGamesByName(rawGames ?? [])
  if (genre !== 'all') games = games.filter((g) => (g as unknown as { category: string }).category === genre)
  if (q) games = games.filter((g) => g.name.toLowerCase().includes(q))

  // Real per-game tournament + player counts — one small query per game, fine
  // at this scale (a handful of games).
  const withCounts = await Promise.all(
    games.map(async (g) => {
      const raw = g as unknown as { id: string; category: string }
      const [{ count: tCount }, { count: pCount }] = await Promise.all([
        supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('game_id', raw.id).neq('status', 'draft'),
        supabase
          .from('tournament_registrations')
          .select('id, tournaments!inner(game_id)', { count: 'exact', head: true })
          .eq('payment_status', 'paid')
          .eq('tournaments.game_id', raw.id),
      ])
      return { ...g, id: raw.id, category: raw.category, tournamentCount: tCount ?? 0, playerCount: pCount ?? 0 }
    }),
  )

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sx-purple/25 blur-[100px]"
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:py-16 lg:pr-64 xl:pr-80">
          <div className="text-center lg:text-left">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Our Arenas</p>
            <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              One Platform.
              <br />
              <span className="text-sx-purple-text">Every Arena.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
              From football to battle royale, we bring every game you love to one competitive home.
              Choose your game and start your journey to greatness.
            </p>
            <Link
              href="#featured-games"
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-sx-border px-6 py-2.5 text-sm font-bold text-white transition-colors hover:border-white/30"
            >
              <Gamepad2 className="h-4 w-4" /> How It Works ►
            </Link>
          </div>
        </div>

        <div className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-4 lg:mx-0 lg:h-auto lg:w-64 lg:pb-0 xl:right-8 xl:w-80">
          <Image
            src="/mascot/mascot-games.png"
            alt="Sentinel, the Sentinel X mascot"
            fill
            priority
            sizes="(min-width: 1280px) 20rem, (min-width: 1024px) 16rem, 13rem"
            className="object-contain object-bottom"
          />
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      <section className="mb-10 grid grid-cols-2 gap-4 rounded-xl border border-sx-border bg-sx-surface p-6 sm:grid-cols-4">
        <StatItem icon="🎮" value={`${games.length}+`} label="Games & Counting" />
        <StatItem icon="🏆" value={String(tournamentCount ?? 0)} label="Tournaments" />
        <StatItem icon="👥" value={String(playerCount ?? 0)} label="Players" />
        <StatItem icon="🎁" value="Amazing" label="Prizes to Win" />
      </section>

      {/* ── Genre tabs + search ───────────────────────────────── */}
      <div id="featured-games" className="mb-2 scroll-mt-24">
        <p className="mb-4 text-sm font-bold uppercase tracking-widest text-white">Featured Games</p>
      </div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <GameGenreTabs genres={GENRES} active={genre} />
        <form className="relative w-full max-w-xs shrink-0">
          {genre !== 'all' && <input type="hidden" name="genre" value={genre} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sx-gray" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search a game..."
            className="w-full rounded-lg border border-sx-border bg-sx-surface py-2 pl-9 pr-3 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple/50 focus:outline-none"
          />
        </form>
      </div>

      {withCounts.length === 0 ? (
        <p className="mb-10 rounded-xl border border-sx-border bg-sx-surface p-6 text-center text-sm text-sx-gray">
          No games match your filters.
        </p>
      ) : (
        <div className="mb-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {withCounts.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      )}

      {/* ── Don't see your favorite game? ────────────────────── */}
      <section className="mb-10 flex flex-col items-center gap-4 rounded-xl border border-sx-border bg-sx-surface p-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="font-bold text-white">Don&apos;t see your favorite game?</p>
          <p className="mt-1 text-sm text-sx-gray">
            We&apos;re always adding new arenas. Stay tuned and follow our community channels for updates!
          </p>
        </div>
        <a
          href={`https://wa.me/?text=${encodeURIComponent("I'd love to see this game on Sentinel X Esports:")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-sx-purple/40 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple/10"
        >
          <Gamepad2 className="h-4 w-4" /> Suggest a Game
        </a>
      </section>

      {/* ── Why Sentinel X strip ──────────────────────────────── */}
      <section className="mb-10 grid grid-cols-2 gap-6 rounded-xl border border-sx-border bg-sx-surface p-6 text-center sm:grid-cols-4">
        <WhyItem icon={Trophy} label="Multiple Games" body="Tournaments across your favorite titles." />
        <WhyItem icon={ShieldCheck} label="Fair Play" body="Secure matches with strict anti-cheat systems." />
        <WhyItem icon={Gift} label="Amazing Prizes" body="Win real cash, rewards, and exclusive items." />
        <WhyItem icon={Users} label="For Everyone" body="From casual players to competitive pros." />
      </section>

    </div>
  )
}

function StatItem({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="font-display text-lg font-black text-white">{value}</p>
        <p className="text-[11px] uppercase tracking-wide text-sx-gray">{label}</p>
      </div>
    </div>
  )
}

function WhyItem({
  icon: Icon,
  label,
  body,
}: {
  icon: typeof Trophy
  label: string
  body: string
}) {
  return (
    <div>
      <Icon className="mx-auto mb-2 h-6 w-6 text-sx-purple-text" />
      <p className="text-sm font-bold text-white">{label}</p>
      <p className="mt-1 text-xs text-sx-gray">{body}</p>
    </div>
  )
}

type GameWithCounts = {
  id: string
  name: string
  slug: string
  icon_url: string | null
  active: boolean
  category: string
  tournamentCount: number
  playerCount: number
}

function GameCard({ game }: { game: GameWithCounts }) {
  const description =
    DESCRIPTIONS[game.name] ?? FALLBACK_BY_CATEGORY[game.category] ?? FALLBACK_BY_CATEGORY.other
  const isLive = game.active && game.tournamentCount > 0
  const bannerImg = findOptionalPublicImage('games', game.slug)

  return (
    <div
      className={`overflow-hidden rounded-xl border border-sx-border bg-sx-surface transition-colors hover:border-sx-purple/40 ${
        !game.active ? 'opacity-80' : ''
      }`}
    >
      <div className="relative h-36">
        {bannerImg ? (
          <Image src={bannerImg} alt={game.name} fill className="object-cover" />
        ) : (
          <ImagePlaceholder className="h-full rounded-none border-x-0 border-t-0" label={`${game.name} key art\n(public/games/${game.slug}.jpg)`} />
        )}
        <span
          className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
            isLive
              ? 'border-sx-green/30 bg-sx-green/10 text-sx-green'
              : game.active
                ? 'border-sx-amber/30 bg-sx-amber/10 text-sx-amber'
                : 'border-white/10 bg-white/5 text-sx-gray'
          }`}
        >
          {isLive ? '● Live' : game.active ? 'Upcoming' : 'Coming Soon'}
        </span>
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="truncate text-sm font-bold text-white">{game.name}</p>
          <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-sx-gray">
            {GENRES.find((g) => g.key === game.category)?.label.replace(/^\S+\s/, '') ?? 'Other'}
          </span>
        </div>
        <p className="mb-3 text-xs text-sx-gray">{description}</p>
        {game.active ? (
          <>
            <div className="mb-3 flex gap-3 text-[11px] text-sx-gray">
              <span>🏆 {game.tournamentCount} Tournaments</span>
              <span>👥 {game.playerCount} Players</span>
            </div>
            <Link
              href={`/tournaments?game=${game.slug}`}
              className="block rounded-lg bg-sx-purple px-3 py-2 text-center text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
            >
              View Tournaments →
            </Link>
          </>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-sx-gray">📅 Coming Soon</p>
            <NotifyMeButton gameId={game.id} />
          </>
        )}
      </div>
    </div>
  )
}
