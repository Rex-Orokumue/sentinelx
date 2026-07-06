import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

const TIER_STYLE: Record<string, string> = {
  elite:      'text-emerald-400',
  trusted:    'text-blue-400',
  developing: 'text-violet-400',
  at_risk:    'text-red-400',
}
const TIER_LABEL: Record<string, string> = {
  elite:      '🟢 Elite',
  trusted:    '🔵 Trusted',
  developing: '🟡 Developing',
  at_risk:    '🔴 At Risk',
}

export default async function HomePage() {
  const supabase = createClient()

  const [{ data: rawTournaments }, { data: players }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, max_players, games(name, icon_url)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, wins, total_matches, sentinel_score, sentinel_tier')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
  ])

  // Ensure any 'active' tournament shows first as featured
  const tournaments = [...(rawTournaments ?? [])].sort((a, b) =>
    a.status === 'active' && b.status !== 'active' ? -1
    : b.status === 'active' && a.status !== 'active' ? 1
    : 0
  ) as TournamentCardData[]

  const featured  = tournaments[0] ?? null
  const upcoming  = tournaments.slice(1)
  const leaderboard = players ?? []

  const shareText = `Play mobile esports in Nigeria on SentinelX Esports — Compete. Win. Level Up! ${SITE_URL}`

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="py-12 text-center">
        <div className="mx-auto mb-6 flex justify-center">
          <Image
            src="/logo-full.png"
            alt="SentinelX Esports — Where Gamers Unite. Champions Rise."
            width={340}
            height={220}
            priority
            className="w-64 sm:w-80"
          />
        </div>
        <p className="mb-8 text-sm text-slate-400">Nigeria's Home of Mobile Esports</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/tournaments"
            className="w-full max-w-xs rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 sm:w-auto"
          >
            Browse Tournaments
          </Link>
          <a
            href={WHATSAPP_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full max-w-xs rounded-xl border border-slate-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:border-slate-500 sm:w-auto"
          >
            Join Community
          </a>
        </div>
      </section>

      {/* ── Featured / Active Tournament ─────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            {featured?.status === 'active' ? '🔴 Live Now' : '🎮 Featured Tournament'}
          </h2>
          <Link href="/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
            View all →
          </Link>
        </div>

        {featured ? (
          <TournamentCard tournament={featured} featured />
        ) : (
          <EmptyState
            icon="🎮"
            title="No active tournament right now"
            body="Join the WhatsApp community to be notified when the next one drops."
          />
        )}
      </section>

      {/* ── Upcoming Tournaments ─────────────────────────────── */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-base font-bold text-white">Upcoming</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        </section>
      )}

      {/* ── Leaderboard Preview ──────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">🏆 Top Players</h2>
          <Link href="/rankings" className="text-sm text-violet-400 hover:text-violet-300">
            Full Rankings →
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {leaderboard.length === 0 ? (
            <EmptyState
              icon="🏅"
              title="Rankings coming soon"
              body="Be the first to compete and claim the top spot."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-right">Wins</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Matches</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, i) => (
                  <tr
                    key={player.id}
                    className="border-b border-slate-800/50 transition-colors last:border-0 hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3.5 font-bold text-slate-400">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                          {((player.username ?? player.display_name ?? '?')[0] ?? '?').toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold leading-tight text-white">
                            {player.display_name ?? player.username ?? 'Anonymous'}
                          </p>
                          {player.sentinel_tier && (
                            <p className={`text-[11px] ${TIER_STYLE[player.sentinel_tier] ?? 'text-slate-400'}`}>
                              {TIER_LABEL[player.sentinel_tier] ?? player.sentinel_tier}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-emerald-400">
                      {player.wins}
                    </td>
                    <td className="hidden px-4 py-3.5 text-right text-slate-400 sm:table-cell">
                      {player.total_matches}
                    </td>
                    <td className="hidden px-4 py-3.5 text-right font-bold text-white sm:table-cell">
                      {player.sentinel_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── WhatsApp Community CTA ───────────────────────────── */}
      <section className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-8 text-center">
        <p className="mb-3 text-4xl">💬</p>
        <h2 className="mb-2 text-xl font-bold text-white">Join Our WhatsApp Community</h2>
        <p className="mb-6 text-sm text-slate-400">
          Get tournament alerts, live match updates, and connect with Nigerian mobile gamers.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={WHATSAPP_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            <WhatsAppIcon />
            Join Community
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10 sm:w-auto"
          >
            <WhatsAppIcon />
            Share on WhatsApp
          </a>
        </div>
      </section>
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}
