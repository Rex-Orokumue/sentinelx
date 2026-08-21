import Link from 'next/link'
import Image from 'next/image'
import { Search, ChevronRight, ChevronLeft, X as XIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { SentinelBubble } from '@/components/ui/SentinelBubble'
import { buildMetadata } from '@/lib/seo/metadata'
import { SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { formatNaira } from '@/lib/format'
import { TOURNAMENT_FAQS } from '@/lib/seo/faq-content'
import { SortSelect } from '@/components/tournament/SortSelect'

const PAGE_SIZE = 4

// image is explicit: this page has no same-segment opengraph-image.tsx, and Next
// does not cascade the root's file-convention image into a segment that returns
// its own openGraph object (see lib/seo/metadata.ts).
export const metadata = buildMetadata({
  title: 'Tournaments — SentinelX Esports',
  description:
    'Browse live, open, and upcoming mobile esports tournaments on SentinelX Esports — Nigeria\'s Home of Mobile Esports. Compete. Win. Level Up!',
  path: '/tournaments',
  image: DEFAULT_OG_IMAGE,
})

const SELECT_COLS =
  'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type'

type SearchParams = { game?: string; q?: string; tab?: string; sort?: string; page?: string }

const TABS = [
  { key: 'all', label: 'All Tournaments' },
  { key: 'live', label: '● Live Now' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
] as const

export default async function TournamentsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const gameFilter = searchParams.game?.trim() || null
  const q = searchParams.q?.trim() || null
  const tab = (['live', 'upcoming', 'completed'].includes(searchParams.tab ?? '') ? searchParams.tab : 'all') as
    | 'all'
    | 'live'
    | 'upcoming'
    | 'completed'
  const sort = searchParams.sort === 'prize' ? 'prize' : 'latest'
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const gamesSelect = gameFilter ? 'games!inner(name, icon_url, slug)' : 'games(name, icon_url, slug)'
  const cols = `${SELECT_COLS}, ${gamesSelect}`

  let listQuery = supabase.from('tournaments').select(cols, { count: 'exact' })
  if (gameFilter) listQuery = listQuery.eq('games.slug', gameFilter)
  if (q) listQuery = listQuery.ilike('title', `%${q}%`)
  if (tab === 'live') listQuery = listQuery.eq('status', 'active')
  else if (tab === 'upcoming') listQuery = listQuery.in('status', ['registration_open', 'registration_closed'])
  else if (tab === 'completed') listQuery = listQuery.eq('status', 'completed')
  else listQuery = listQuery.neq('status', 'draft')
  listQuery =
    sort === 'prize'
      ? listQuery.order('prize_pool', { ascending: false })
      : listQuery.order('created_at', { ascending: false })
  listQuery = listQuery.range(offset, offset + PAGE_SIZE - 1)

  const [
    { data: rows, count: total },
    { count: liveCount },
    { data: activePrizeRows },
    { count: activeGamesCount },
    { count: competingCount },
  ] = await Promise.all([
    listQuery,
    supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('tournaments').select('prize_pool').in('status', ['active', 'registration_open']),
    supabase.from('games').select('id', { count: 'exact', head: true }).eq('active', true),
    supabase
      .from('tournament_registrations')
      .select('id, tournaments!inner(status)', { count: 'exact', head: true })
      .eq('payment_status', 'paid')
      .in('tournaments.status', ['active', 'registration_open']),
  ])

  const tournaments = (rows ?? []) as unknown as TournamentCardData[]
  const totalCount = total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const prizePool = (activePrizeRows ?? []).reduce((sum, r) => sum + (r.prize_pool ?? 0), 0)

  function hrefFor(params: Partial<SearchParams>) {
    const merged: SearchParams = { game: gameFilter ?? undefined, q: q ?? undefined, tab, sort, ...params }
    const sp = new URLSearchParams()
    if (merged.game) sp.set('game', merged.game)
    if (merged.q) sp.set('q', merged.q)
    if (merged.tab && merged.tab !== 'all') sp.set('tab', merged.tab)
    if (merged.sort && merged.sort !== 'latest') sp.set('sort', merged.sort)
    if (merged.page && merged.page !== '1') sp.set('page', merged.page)
    const qs = sp.toString()
    return qs ? `/tournaments?${qs}` : '/tournaments'
  }

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
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Tournaments</p>
            <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Compete. Win.
              <br />
              <span className="text-sx-purple-text">Make History.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
              Join the biggest mobile esports tournaments in Nigeria. Prove your skills, climb the ranks and
              win amazing prizes.
            </p>
            <form className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {gameFilter && <input type="hidden" name="game" value={gameFilter} />}
              {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
              {sort !== 'latest' && <input type="hidden" name="sort" value={sort} />}
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sx-gray" />
                <input
                  type="text"
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="Search tournaments..."
                  className="w-full rounded-lg border border-sx-border bg-sx-bg py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple/50 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full max-w-xs rounded-lg border border-sx-border px-6 py-2.5 text-sm font-bold text-white transition-colors hover:border-white/30 sm:w-auto"
              >
                Search
              </button>
              <Link
                href="#how-to-join"
                className="w-full max-w-xs rounded-lg border border-sx-border px-6 py-2.5 text-center text-sm font-bold text-white transition-colors hover:border-white/30 sm:w-auto"
              >
                How it Works ►
              </Link>
            </form>
          </div>
        </div>

        <div className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-4 lg:mx-0 lg:h-auto lg:w-64 lg:pb-0 xl:right-8 xl:w-80">
          <Image
            src="/mascot/mascot-tournaments.png"
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
        <StatItem icon="🏆" value={String(liveCount ?? 0)} label="Live Tournaments" />
        <StatItem icon="👥" value={String(competingCount ?? 0)} label="Players Competing Now" />
        <StatItem icon="🎮" value={String(activeGamesCount ?? 0)} label="Games Supported" />
        <StatItem icon="🎁" value={formatNaira(prizePool)} label="Prize Pool Up for Grabs" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── Right sidebar (shown first on mobile) ─────────────────────────────────── */}
        <aside className="order-first space-y-6 lg:order-last">
          <HowToJoinCard />
          <TournamentFaqCard />
        </aside>

        {/* ── Left column ───────────────────────────────────── */}
        <div id="guide-target-tournaments" className="min-w-0 lg:order-first">
          {gameFilter && (
            <div className="mb-4">
              <Link
                href={hrefFor({ game: undefined })}
                className="inline-flex items-center gap-1.5 rounded-full border border-sx-purple/30 bg-sx-purple/10 px-3 py-1 text-xs font-bold text-sx-purple-text"
              >
                Filtered by game <XIcon className="h-3 w-3" />
              </Link>
            </div>
          )}

          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={hrefFor({ tab: t.key === 'all' ? undefined : t.key, page: undefined })}
                  className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                    tab === t.key
                      ? 'border-sx-purple text-white'
                      : 'border-transparent text-sx-gray hover:text-white'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <SortSelect value={sort} />
          </div>

          {tournaments.length === 0 ? (
            <EmptyState
              icon="🎮"
              title={q || gameFilter ? 'No tournaments match your filters' : 'No tournaments yet'}
              body="Join the WhatsApp community to be notified when the next one drops."
            />
          ) : (
            <div className="space-y-4">
              {tournaments.map((t) => (
                <TournamentCard key={t.id} tournament={t} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-1">
              <Link
                href={hrefFor({ page: String(Math.max(1, page - 1)) })}
                aria-disabled={page === 1}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border border-sx-border ${
                  page === 1 ? 'pointer-events-none opacity-30' : 'text-white hover:border-sx-purple/40'
                }`}
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  href={hrefFor({ page: String(n) })}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${
                    n === page ? 'bg-sx-purple text-white' : 'border border-sx-border text-white hover:border-sx-purple/40'
                  }`}
                >
                  {n}
                </Link>
              ))}
              <Link
                href={hrefFor({ page: String(Math.min(totalPages, page + 1)) })}
                aria-disabled={page === totalPages}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border border-sx-border ${
                  page === totalPages ? 'pointer-events-none opacity-30' : 'text-white hover:border-sx-purple/40'
                }`}
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </nav>
          )}
        </div>
      </div>

      <ShareCta />
      <SentinelBubble variant="tournaments" />
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

const STEPS = [
  { n: 1, title: 'Choose Tournament', body: 'Browse open tournaments and pick the one you want to join.' },
  { n: 2, title: 'Register', body: 'Fill in your details and complete registration.' },
  { n: 3, title: 'Check In', body: 'Join the tournament lobby when check-in opens.' },
  { n: 4, title: 'Play & Win', body: 'Compete, win matches and claim victory!' },
]

function HowToJoinCard() {
  return (
    <div id="how-to-join" className="scroll-mt-24 rounded-xl border border-sx-border bg-sx-surface p-6">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">How to Join</p>
      <div className="space-y-4">
        {STEPS.map((s) => (
          <div key={s.n} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sx-purple/15 text-xs font-bold text-sx-purple-text">
              {s.n}
            </span>
            <div>
              <p className="text-sm font-bold text-white">{s.title}</p>
              <p className="mt-0.5 text-xs text-sx-gray">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
      <Link
        href="/tournament-guide"
        className="mt-5 block rounded-lg border border-sx-border px-4 py-2.5 text-center text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        View Full Guide ↗
      </Link>
    </div>
  )
}

function TournamentFaqCard() {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Tournament FAQ</p>
      <div className="space-y-2">
        {TOURNAMENT_FAQS.map((item) => (
          <details key={item.question} className="group rounded-lg border border-sx-border/70 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-white marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-xs text-sx-gray">{item.answer}</p>
          </details>
        ))}
      </div>
      <Link
        href="/tournament-faqs"
        className="mt-4 block text-center text-xs font-bold text-sx-purple-text hover:text-white"
      >
        View All FAQs →
      </Link>
    </div>
  )
}

function ShareCta() {
  const shareText = `Compete in mobile esports tournaments on SentinelX Esports 🎮 ${SITE_URL}/tournaments`
  return (
    <div className="mt-10 flex justify-center">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
        Share on WhatsApp
      </a>
    </div>
  )
}
