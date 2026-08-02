import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { prefillScore, hasScoreMismatch } from '@/lib/matches/verify'
import { ResultReviewForms } from '@/components/admin/ResultReviewForms'
import { DeclareNoShowWinnerForm } from '@/components/admin/DeclareNoShowWinnerForm'
import { MarkBothNoShowForm } from '@/components/admin/MarkBothNoShowForm'
import { canMarkBothNoShow } from '@/lib/matches/noshow-eligibility'
import { resolveBackLink } from '@/lib/nav/back-link'
import { checkInVerdict, soleAttendee } from '@/lib/matches/check-in'
import { VoidBetsList } from '@/components/admin/VoidBetsList'
import { BettingLockToggle } from '@/components/admin/BettingLockToggle'

export const metadata: Metadata = { title: 'Review · Admin · SentinelX' }

type ProfileRef = { id: string; username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export default async function ReviewMatchPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { from?: string | string[] }
}) {
  await requireStaff()
  const supabase = createClient()
  const { data: mRaw } = await supabase
    .from('matches')
    .select(
      'id, status, resolution, admin_note, noshow_flagged_at, tournament_id, betting_locked, ' +
        'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!mRaw) notFound()
  const m = mRaw as unknown as {
    id: string
    status: string
    resolution: string | null
    admin_note: string | null
    noshow_flagged_at: string | null
    tournament_id: string
    betting_locked: boolean
    player_a: ProfileRef
    player_b: ProfileRef
  }

  // Reached from the global results queue, a tournament's results page, and the
  // no-show banner on its matches page — the back link follows whichever.
  const backLink = resolveBackLink(
    searchParams.from,
    {
      'tournament-results': {
        href: `/admin/tournaments/${m.tournament_id}/results`,
        label: 'Tournament results',
      },
      'tournament-matches': {
        href: `/admin/tournaments/${m.tournament_id}/matches`,
        label: 'Matches',
      },
    },
    { href: '/admin/results', label: 'Results queue' },
  )

  const { data: subs } = await supabase
    .from('match_results')
    .select('score_a, score_b, recording_url, screenshot_url, status, submitted_by')
    .eq('match_id', params.id)
    .order('created_at')

  const submissions = (subs ?? []) as {
    score_a: number
    score_b: number
    recording_url: string | null
    screenshot_url: string | null
    status: string
    submitted_by: string
  }[]

  // Signed URLs for each screenshot (service-role).
  const admin = createAdminClient()
  const withUrls = await Promise.all(
    submissions.map(async (s) => {
      let url: string | null = null
      if (s.screenshot_url) {
        const { data } = await admin.storage.from('match-evidence').createSignedUrl(s.screenshot_url, 3600)
        url = data?.signedUrl ?? null
      }
      return { ...s, signedUrl: url }
    }),
  )

  const s0 = submissions[0] ? { scoreA: submissions[0].score_a, scoreB: submissions[0].score_b } : null
  const s1 = submissions[1] ? { scoreA: submissions[1].score_a, scoreB: submissions[1].score_b } : null
  const prefill = prefillScore(s0, s1)
  const mismatch = hasScoreMismatch(submissions.map((s) => ({ scoreA: s.score_a, scoreB: s.score_b })))

  const playerA = nameOf(m.player_a)
  const playerB = nameOf(m.player_b)

  // Who marked themselves present. The decisive evidence when exactly one
  // player turned up — the case that used to be indistinguishable from a
  // mutual no-show.
  const { data: checkInRows } = await supabase
    .from('match_check_ins')
    .select('player_id, checked_in_at')
    .eq('match_id', params.id)
  const checkIns = (checkInRows ?? []) as { player_id: string; checked_in_at: string }[]
  const checkInState = {
    playerACheckedIn: checkIns.some((c) => c.player_id === m.player_a?.id),
    playerBCheckedIn: checkIns.some((c) => c.player_id === m.player_b?.id),
  }
  const verdict = checkInVerdict(checkInState)
  const attendee = soleAttendee(checkInState, m.player_a?.id ?? null, m.player_b?.id ?? null)
  const attendeeName = attendee === m.player_a?.id ? playerA : attendee === m.player_b?.id ? playerB : null
  const eligibleForMutualNoShow = canMarkBothNoShow({
    status: m.status,
    noshowFlaggedAt: m.noshow_flagged_at,
    submissionCount: submissions.length,
  })

  const { data: betRows } = await supabase
    .from('match_bets')
    .select('id, stake_amount, side, player:profiles!match_bets_player_id_fkey(username, display_name)')
    .eq('match_id', params.id)
    .eq('status', 'active')
  const activeBets = ((betRows ?? []) as { id: string; stake_amount: number; side: 'player_a' | 'player_b'; player: ProfileRef }[]).map(
    (b) => ({
      id: b.id,
      playerName: nameOf(b.player),
      side: b.side,
      stakeAmount: b.stake_amount,
    }),
  )

  return (
    <section className="max-w-xl">
      <Link href={backLink.href} className="text-sm text-violet-400 hover:text-violet-300">
        ← {backLink.label}
      </Link>
      <h2 className="mb-1 mt-2 text-base font-bold text-white">
        {playerA} vs {playerB}
      </h2>
      <p className="mb-4 text-xs text-slate-500">Status: {m.status}</p>

      <div className="mb-4">
        <BettingLockToggle matchId={m.id} alreadyLocked={m.betting_locked} />
        <VoidBetsList bets={activeBets} />
      </div>

      {m.admin_note && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Dispute note: {m.admin_note}
        </p>
      )}

      {mismatch && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold text-amber-300">
          ⚠️ Players reported different scores — review the evidence carefully before confirming.
        </p>
      )}

      <div
        className={`mb-4 rounded-xl border p-3 text-sm ${
          verdict === 'one'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-slate-800 bg-slate-900 text-slate-400'
        }`}
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Check-in</p>
        <p className="mt-1">
          {verdict === 'one' ? (
            <>
              Only <span className="font-bold">{attendeeName}</span> checked in — their opponent never
              marked themselves present.
            </>
          ) : verdict === 'both' ? (
            'Both players checked in.'
          ) : (
            'Neither player checked in.'
          )}
        </p>
      </div>

      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Submissions ({withUrls.length})
      </h3>
      <div className="mb-6 space-y-2">
        {withUrls.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">
            No submissions — enter the official score below (e.g. a walkover) or chase the players.
          </p>
        ) : (
          withUrls.map((s, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
              <p className="font-bold text-white">
                Reported {s.score_a} – {s.score_b}{' '}
                <span className="text-xs font-normal text-slate-500">({s.status})</span>
              </p>
              <div className="mt-1 flex gap-3 text-xs">
                {s.signedUrl && (
                  <a href={s.signedUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                    Screenshot →
                  </a>
                )}
                {s.recording_url && (
                  <a href={s.recording_url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                    Recording →
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <ResultReviewForms matchId={m.id} playerAName={playerA} playerBName={playerB} prefill={prefill} />

      {!(m.status === 'completed' && m.resolution === null) && (
        <div className="mt-4 space-y-4">
          <DeclareNoShowWinnerForm
            matchId={m.id}
            playerAId={m.player_a?.id ?? ''}
            playerAName={playerA}
            playerBId={m.player_b?.id ?? ''}
            playerBName={playerB}
          />
          {eligibleForMutualNoShow && <MarkBothNoShowForm matchId={m.id} />}
        </div>
      )}
    </section>
  )
}
