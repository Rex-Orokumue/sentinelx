import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VideoEmbed } from '@/components/match/VideoEmbed'
import { ResultSubmissionForm } from '@/components/match/ResultSubmissionForm'
import { CheckInPanel } from '@/components/match/CheckInPanel'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { SITE_URL } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildMatchJsonLd } from '@/lib/seo/schema/event'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { formatFixtureDate } from '@/lib/format'
import { resolveBackLink } from '@/lib/nav/back-link'
import { buildRecordingWhatsAppUrl } from '@/lib/matches/recording-whatsapp'
import { opponentDisplayName } from '@/lib/matches/opponent'
import { ShareCardButton } from '@/components/match/ShareCardButton'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
import { WagerWidget } from '@/components/match/WagerWidget'
import { wagerWindowOpen } from '@/lib/wagers/market'
import { getCoinBalance } from '@/lib/coins/service'
import { GameBadge } from '@/components/game/GameBadge'
import { resolveGameIconUrl } from '@/lib/games/icon'

type ProfileRef = {
  username: string | null
  display_name: string | null
  avatar_url: string | null
  membership_tier: string | null
} | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

// player_b's slot, bye-aware: an empty slot on a bye match reads "BYE", not "TBD".
function opponentName(m: { player_b: ProfileRef; status: string }): string {
  return opponentDisplayName(m.player_b?.display_name ?? m.player_b?.username, m.status)
}

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'SCHEDULED', cls: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
  live:      { label: 'LIVE',      cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  completed: { label: 'FULL TIME', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: 'DISPUTED',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled: { label: 'CANCELLED', cls: 'bg-slate-700/40 text-slate-500 border-slate-700/50' },
  bye:       { label: 'BYE',       cls: 'bg-slate-700/40 text-slate-400 border-slate-700/50' },
}

const MATCH_SELECT =
  'id, round, status, score_a, score_b, scheduled_at, is_full_day, youtube_stream_url, replay_url, player_a_id, player_b_id, ' +
  'tournaments(title, slug, games(name, icon_url, slug, category)), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url, membership_tier), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url, membership_tier)'

type MatchRow = {
  id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  is_full_day: boolean
  youtube_stream_url: string | null
  replay_url: string | null
  player_a_id: string | null
  player_b_id: string | null
  tournaments:
    | {
        title: string
        slug: string
        games: MatchGameRef | MatchGameRef[]
      }
    | null
  player_a: ProfileRef
  player_b: ProfileRef
}

type MatchGameRef = { name: string; icon_url: string | null; slug: string | null; category: string | null } | null

function matchGame(t: MatchRow['tournaments']): MatchGameRef {
  if (!t) return null
  return (Array.isArray(t.games) ? t.games[0] ?? null : t.games) as MatchGameRef
}

async function getMatch(id: string): Promise<MatchRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('matches').select(MATCH_SELECT).eq('id', id).maybeSingle()
  return data as MatchRow | null
}

export async function generateMetadata({ params }: { params: { id: string; locale: Locale } }): Promise<Metadata> {
  const m = await getMatch(params.id)
  if (!m) return { title: 'Match — Sentinel X' }
  const title = `${nameOf(m.player_a)} vs ${opponentName(m)} — Sentinel X`
  const description = m.tournaments ? `${m.tournaments.title} on Sentinel X.` : 'Mobile esports match on Sentinel X.'
  return buildMetadata({ title, description, path: `/matches/${m.id}`, locale: params.locale })
}

export default async function MatchCentrePage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { from?: string | string[]; u?: string | string[] }
}) {
  const supabase = createClient()
  const m = await getMatch(params.id)
  if (!m) notFound()
  const game = matchGame(m.tournaments)
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isParticipant = !!user && (user.id === m.player_a_id || user.id === m.player_b_id)

  // Participant's own submission only (never the opponent's).
  let myResult:
    | { score_a: number | null; score_b: number | null; recording_url: string | null; screenshot_url: string | null; status: string }
    | null = null
  let myUsername = ''
  if (isParticipant) {
    const [{ data }, { data: myProfile }] = await Promise.all([
      supabase
        .from('match_results')
        .select('score_a, score_b, recording_url, screenshot_url, status')
        .eq('match_id', m.id)
        .eq('submitted_by', user!.id)
        .maybeSingle(),
      supabase.from('profiles').select('username, display_name').eq('id', user!.id).maybeSingle(),
    ])
    myResult = data
    myUsername = myProfile?.username ?? myProfile?.display_name ?? 'Player'
  }

  // Signed URL for the participant's own screenshot — generated fresh each load.
  let screenshotUrl: string | null = null
  if (myResult?.screenshot_url) {
    const { data } = await admin.storage.from('match-evidence').createSignedUrl(myResult.screenshot_url, 3600)
    screenshotUrl = data?.signedUrl ?? null
  }

  const status = STATUS[m.status] ?? STATUS.scheduled
  const resultConfirmed = m.status === 'completed'
  const showScore = m.score_a != null && m.score_b != null
  // Mirrors lib/dashboard/fixtures.ts's matchDayReached: an unset date is
  // treated as "not reached" — nothing to compare against yet.
  const dayReached = m.scheduled_at != null && new Date(m.scheduled_at).getTime() <= Date.now()
  const canSubmit =
    isParticipant &&
    dayReached &&
    m.status !== 'cancelled' &&
    m.status !== 'bye' &&
    !resultConfirmed &&
    (!myResult || myResult.status === 'pending')
  const waitingForMatchDay =
    isParticipant &&
    !dayReached &&
    m.status !== 'cancelled' &&
    m.status !== 'bye' &&
    !resultConfirmed &&
    !myResult
  // Check-in evidence: who turned up. Public read, so the panel can show a
  // participant whether their opponent has appeared.
  const { data: checkInRows } = await supabase
    .from('match_check_ins')
    .select('player_id')
    .eq('match_id', m.id)
  const checkedInIds = new Set(((checkInRows ?? []) as { player_id: string }[]).map((r) => r.player_id))
  const iCheckedIn = !!user && checkedInIds.has(user.id)
  const opponentId = user?.id === m.player_a_id ? m.player_b_id : m.player_a_id
  const opponentCheckedIn = !!opponentId && checkedInIds.has(opponentId)
  // Shown while the match is still open — once it's resolved there's nothing
  // left to be present for.
  const showCheckIn =
    isParticipant && dayReached && (m.status === 'scheduled' || m.status === 'live')

  const { data: wagerRows } = await supabase
    .from('match_wagers')
    .select('bettor_id, pick_player_id, stake_coins, status, payout_coins')
    .eq('match_id', m.id)
  const wagers = (wagerRows ?? []) as { bettor_id: string; pick_player_id: string; stake_coins: number; status: string; payout_coins: number | null }[]
  const wagerPools = {
    playerA: wagers.filter((w) => w.pick_player_id === m.player_a_id && w.status !== 'refunded').reduce((s, w) => s + w.stake_coins, 0),
    playerB: wagers.filter((w) => w.pick_player_id === m.player_b_id && w.status !== 'refunded').reduce((s, w) => s + w.stake_coins, 0),
  }
  const myWagerRow = user ? wagers.find((w) => w.bettor_id === user.id) ?? null : null
  const myWager = myWagerRow ? { pickPlayerId: myWagerRow.pick_player_id, stakeCoins: myWagerRow.stake_coins } : null
  const wagerOutcome =
    myWagerRow && (myWagerRow.status === 'won' || myWagerRow.status === 'lost')
      ? { won: myWagerRow.status === 'won', payoutCoins: myWagerRow.payout_coins ?? 0, stakeCoins: myWagerRow.stake_coins }
      : null
  const wagerDisabledReason = isParticipant
    ? 'You cannot wager on your own match.'
    : !wagerWindowOpen({ status: m.status, scheduled_at: m.scheduled_at, player_a_id: m.player_a_id, player_b_id: m.player_b_id, is_full_day: m.is_full_day })
      ? 'Wagering is closed. Results pending.'
      : null
  const wagerCoinBalance = user ? await getCoinBalance(admin, user.id) : 0

  const shareText = `${nameOf(m.player_a)} vs ${opponentName(m)} on Sentinel X 🎮 ${SITE_URL}/matches/${m.id}`

  // This page is entered from the bracket, the dashboard, a player profile and
  // TV — a single hardcoded back link sent everyone to the tournament page,
  // including visitors who were never on it. Entry points tag themselves with
  // ?from=; anything unrecognized falls back to the tournament (or /tournaments
  // when the match has no tournament attached).
  const profileUsername = typeof searchParams.u === 'string' ? searchParams.u : null
  const backLink = resolveBackLink(
    searchParams.from,
    {
      ...(m.tournaments
        ? { bracket: { href: `/tournaments/${m.tournaments.slug}/bracket`, label: 'Bracket' } }
        : {}),
      dashboard: { href: '/dashboard', label: 'Dashboard' },
      tv: { href: '/tv', label: 'Sentinel X TV' },
      ...(profileUsername
        ? { profile: { href: `/players/${profileUsername}`, label: `${profileUsername}'s profile` } }
        : {}),
    },
    m.tournaments
      ? { href: `/tournaments/${m.tournaments.slug}`, label: m.tournaments.title }
      : { href: '/tournaments', label: 'All tournaments' },
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <JsonLd
        data={buildMatchJsonLd({
          id: m.id,
          playerAName: nameOf(m.player_a),
          playerBName: opponentName(m),
          status: m.status,
          scoreA: m.score_a,
          scoreB: m.score_b,
          tournamentTitle: m.tournaments?.title ?? null,
          tournamentSlug: m.tournaments?.slug ?? null,
        })}
      />
      {m.tournaments ? (
        <JsonLd
          data={buildBreadcrumbJsonLd([
            { name: 'Tournaments', path: '/tournaments' },
            { name: m.tournaments.title, path: `/tournaments/${m.tournaments.slug}` },
            { name: `${nameOf(m.player_a)} vs ${opponentName(m)}`, path: `/matches/${m.id}` },
          ])}
        />
      ) : (
        <JsonLd
          data={buildBreadcrumbJsonLd([
            { name: `${nameOf(m.player_a)} vs ${opponentName(m)}`, path: `/matches/${m.id}` },
          ])}
        />
      )}
      <Link href={backLink.href} className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300">
        ← {backLink.label}
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-3 flex justify-center">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
        {game && (
          <p className="mb-3 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <GameBadge name={game.name} iconUrl={resolveGameIconUrl(game)} category={game.category} />
            {game.name}
          </p>
        )}
        {formatFixtureDate(m.scheduled_at, m.is_full_day) && (
          <p className="mb-3 text-center text-xs font-semibold text-slate-400">
            {formatFixtureDate(m.scheduled_at, m.is_full_day)}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col items-center gap-2 sm:flex-row sm:justify-end">
            <HexAvatar
              src={m.player_a?.avatar_url ?? null}
              username={nameOf(m.player_a)}
              tier={(m.player_a?.membership_tier ?? 'recruit') as MembershipTier}
              size="md"
            />
            <p className="text-lg font-bold text-white">{nameOf(m.player_a)}</p>
          </div>
          <p className="shrink-0 text-2xl font-black tabular-nums text-white">
            {showScore ? `${m.score_a} – ${m.score_b}` : 'vs'}
          </p>
          <div className="flex flex-1 flex-col items-center gap-2 sm:flex-row">
            <HexAvatar
              src={m.player_b?.avatar_url ?? null}
              username={opponentName(m)}
              tier={(m.player_b?.membership_tier ?? 'recruit') as MembershipTier}
              size="md"
            />
            <p className="text-lg font-bold text-white">{opponentName(m)}</p>
          </div>
        </div>
      </div>

      {/* Video */}
      <div className="mb-6">
        {/* youtube_stream_url / replay_url are YouTube-only — validated by
            matchEditSchema (lib/matches/edit-schema.ts) via parseYouTubeId.
            If that validation changes, update this embed in the same change. */}
        <VideoEmbed streamUrl={m.youtube_stream_url} replayUrl={m.replay_url} isLive={m.status === 'live'} />
      </div>

      {/* Result confirmed banner */}
      {resultConfirmed && (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-center text-sm font-semibold text-emerald-400">
          ✅ Result confirmed by an admin.
        </div>
      )}

      {!isParticipant && (
        <WagerWidget
          matchId={m.id}
          playerAId={m.player_a_id ?? ''}
          playerBId={m.player_b_id ?? ''}
          playerAName={nameOf(m.player_a)}
          playerBName={opponentName(m)}
          playerAAvatar={m.player_a?.avatar_url ?? null}
          playerBAvatar={m.player_b?.avatar_url ?? null}
          playerATier={(m.player_a?.membership_tier ?? 'recruit') as MembershipTier}
          playerBTier={(m.player_b?.membership_tier ?? 'recruit') as MembershipTier}
          pools={wagerPools}
          myWager={myWager}
          coinBalance={wagerCoinBalance}
          disabledReason={wagerDisabledReason}
          outcome={wagerOutcome}
        />
      )}

      {/* Participant: presence, before any result exists to submit */}
      {showCheckIn && (
        <CheckInPanel
          matchId={m.id}
          alreadyCheckedIn={iCheckedIn}
          opponentCheckedIn={opponentCheckedIn}
          opponentName={user!.id === m.player_a_id ? opponentName(m) : nameOf(m.player_a)}
        />
      )}

      {/* Participant: submission form or locked status */}
      {isParticipant && canSubmit && (
        <div className="mb-6">
          <ResultSubmissionForm
            matchId={m.id}
            playerAName={nameOf(m.player_a)}
            playerBName={opponentName(m)}
            recordingWhatsAppUrl={buildRecordingWhatsAppUrl({
              adminWhatsapp: process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? null,
              username: myUsername,
              tournamentTitle: m.tournaments?.title ?? 'Sentinel X',
              playerAName: nameOf(m.player_a),
              playerBName: opponentName(m),
            })}
            initial={
              myResult
                ? {
                    scoreA: myResult.score_a,
                    scoreB: myResult.score_b,
                    recordingUrl: myResult.recording_url,
                    hasScreenshot: !!myResult.screenshot_url,
                  }
                : null
            }
          />
        </div>
      )}

      {waitingForMatchDay && (
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
          <p className="text-sm font-bold text-white">This match hasn&apos;t started yet</p>
          <p className="mt-1 text-sm text-slate-400">
            {formatFixtureDate(m.scheduled_at, m.is_full_day) ??
              "The date hasn't been set yet"}{' '}
            — check back then to submit your result.
          </p>
        </div>
      )}

      {isParticipant && myResult && !canSubmit && !resultConfirmed && (
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm font-bold text-white">
            Your submission — {myResult.status === 'under_review' ? 'under admin review' : myResult.status}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            You reported {myResult.score_a} – {myResult.score_b}.
          </p>
          {screenshotUrl && (
            <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-violet-400 hover:text-violet-300">
              View your screenshot →
            </a>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Share on WhatsApp
        </a>
        <ShareCardButton matchId={m.id} shareText={shareText} />
      </div>
    </div>
  )
}
