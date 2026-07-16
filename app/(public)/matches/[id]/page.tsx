import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VideoEmbed } from '@/components/match/VideoEmbed'
import { ResultSubmissionForm } from '@/components/match/ResultSubmissionForm'
import { buildMetadata } from '@/lib/seo/metadata'
import { SITE_URL } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildMatchJsonLd } from '@/lib/seo/schema/event'

type ProfileRef = { username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
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
  'id, round, status, score_a, score_b, youtube_stream_url, replay_url, player_a_id, player_b_id, ' +
  'tournaments(title, slug), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name)'

type MatchRow = {
  id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  youtube_stream_url: string | null
  replay_url: string | null
  player_a_id: string | null
  player_b_id: string | null
  tournaments: { title: string; slug: string } | null
  player_a: ProfileRef
  player_b: ProfileRef
}

async function getMatch(id: string): Promise<MatchRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('matches').select(MATCH_SELECT).eq('id', id).maybeSingle()
  return data as MatchRow | null
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const m = await getMatch(params.id)
  if (!m) return { title: 'Match — Sentinel X' }
  const title = `${nameOf(m.player_a)} vs ${nameOf(m.player_b)} — Sentinel X`
  const description = m.tournaments ? `${m.tournaments.title} on Sentinel X.` : 'Mobile esports match on Sentinel X.'
  return buildMetadata({ title, description, path: `/matches/${m.id}` })
}

export default async function MatchCentrePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const m = await getMatch(params.id)
  if (!m) notFound()

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
    const admin = createAdminClient()
    const { data } = await admin.storage.from('match-evidence').createSignedUrl(myResult.screenshot_url, 3600)
    screenshotUrl = data?.signedUrl ?? null
  }

  const status = STATUS[m.status] ?? STATUS.scheduled
  const resultConfirmed = m.status === 'completed'
  const showScore = m.score_a != null && m.score_b != null
  const canSubmit =
    isParticipant &&
    m.status !== 'cancelled' &&
    m.status !== 'bye' &&
    !resultConfirmed &&
    (!myResult || myResult.status === 'pending')
  const shareText = `${nameOf(m.player_a)} vs ${nameOf(m.player_b)} on Sentinel X 🎮 ${SITE_URL}/matches/${m.id}`

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <JsonLd
        data={buildMatchJsonLd({
          id: m.id,
          playerAName: nameOf(m.player_a),
          playerBName: nameOf(m.player_b),
          status: m.status,
          scoreA: m.score_a,
          scoreB: m.score_b,
          tournamentTitle: m.tournaments?.title ?? null,
          tournamentSlug: m.tournaments?.slug ?? null,
        })}
      />
      {m.tournaments && (
        <Link
          href={`/tournaments/${m.tournaments.slug}`}
          className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          ← {m.tournaments.title}
        </Link>
      )}

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-3 flex justify-center">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="flex-1 text-right text-lg font-bold text-white">{nameOf(m.player_a)}</p>
          <p className="shrink-0 text-2xl font-black tabular-nums text-white">
            {showScore ? `${m.score_a} – ${m.score_b}` : 'vs'}
          </p>
          <p className="flex-1 text-left text-lg font-bold text-white">{nameOf(m.player_b)}</p>
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

      {/* Participant: submission form or locked status */}
      {isParticipant && canSubmit && (
        <div className="mb-6">
          <ResultSubmissionForm
            matchId={m.id}
            playerAName={nameOf(m.player_a)}
            playerBName={nameOf(m.player_b)}
            username={myUsername}
            tournamentTitle={m.tournaments?.title ?? 'Sentinel X'}
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

      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        Share on WhatsApp
      </a>
    </div>
  )
}
