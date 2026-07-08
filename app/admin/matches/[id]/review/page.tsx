import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { prefillScore } from '@/lib/matches/verify'
import { ResultReviewForms } from '@/components/admin/ResultReviewForms'

export const metadata: Metadata = { title: 'Review · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export default async function ReviewMatchPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: mRaw } = await supabase
    .from('matches')
    .select(
      'id, status, admin_note, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!mRaw) notFound()
  const m = mRaw as unknown as {
    id: string
    status: string
    admin_note: string | null
    player_a: ProfileRef
    player_b: ProfileRef
  }

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

  const playerA = nameOf(m.player_a)
  const playerB = nameOf(m.player_b)

  return (
    <section className="max-w-xl">
      <Link href="/admin/results" className="text-sm text-violet-400 hover:text-violet-300">
        ← Results queue
      </Link>
      <h2 className="mb-1 mt-2 text-base font-bold text-white">
        {playerA} vs {playerB}
      </h2>
      <p className="mb-4 text-xs text-slate-500">Status: {m.status}</p>

      {m.admin_note && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Dispute note: {m.admin_note}
        </p>
      )}

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
    </section>
  )
}
