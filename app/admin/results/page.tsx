import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bucketReviewQueue, type ReviewMatchInput } from '@/lib/matches/review-queue'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
type TournamentRef = { title: string; slug: string } | { title: string; slug: string }[] | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}
function firstT(t: TournamentRef): { title: string; slug: string } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function AdminResultsPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, scheduled_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'tournament:tournaments(title, slug), ' +
        'match_results(count)',
    )
    .in('status', ['scheduled', 'live', 'disputed'])

  const rows: ReviewMatchInput[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
      match_results: { count: number }[]
    }
    const t = firstT(m.tournament)
    return {
      id: m.id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      submissionCount: m.match_results?.[0]?.count ?? 0,
      round: m.round,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  const { needsReview, noSubmission, disputed } = bucketReviewQueue(rows, new Date())

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Results to verify</h2>
      {needsReview.length + noSubmission.length + disputed.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          Nothing to review right now.
        </p>
      ) : (
        <div className="space-y-8">
          <Bucket title="Needs review" items={needsReview} />
          <Bucket title="No submission" items={noSubmission} />
          <Bucket title="Disputed" items={disputed} />
        </div>
      )}
    </section>
  )
}

function Bucket({ title, items }: { title: string; items: ReviewMatchInput[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
          >
            <p className="truncate font-bold text-white">
              {m.playerAName} <span className="text-slate-500">vs</span> {m.playerBName}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {m.tournamentTitle} · {m.round.replace(/_/g, ' ')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
