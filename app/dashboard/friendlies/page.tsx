import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bucketFriendlies, type FriendlyMatchRow } from '@/lib/friendly-matches/buckets'

export const metadata: Metadata = {
  title: 'Friendlies · SentinelX Esports',
  robots: { index: false, follow: false },
}

type ProfileRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function first(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}
function nameOf(p: ReturnType<typeof first>): string {
  return p?.display_name ?? p?.username ?? 'Player'
}

type Row = FriendlyMatchRow & {
  stake_amount: number | null
  challenger: ProfileRef
  opponent: ProfileRef
}

export default async function FriendliesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/friendlies')

  const { data: raw } = await supabase
    .from('friendly_matches')
    .select(
      'id, status, stake_amount, challenger_id, opponent_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  const rows = ((raw as unknown[] | null) ?? []).map((r) => {
    const row = r as {
      id: string
      status: string
      stake_amount: number | null
      challenger_id: string
      opponent_id: string
      challenger: ProfileRef
      opponent: ProfileRef
    }
    return { ...row, challengerId: row.challenger_id, opponentId: row.opponent_id } as Row
  })
  const { pending, active, completed } = bucketFriendlies(rows, user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Friendlies</h1>
      <Group title="Pending" rows={pending} viewerId={user.id} empty="No pending challenges." />
      <Group title="Active" rows={active} viewerId={user.id} empty="No active friendlies." />
      <Group title="Completed" rows={completed} viewerId={user.id} empty="No completed friendlies yet." />
    </div>
  )
}

function Group({
  title,
  rows,
  viewerId,
  empty,
}: {
  title: string
  rows: Row[]
  viewerId: string
  empty: string
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isChallenger = r.challengerId === viewerId
            const opponent = isChallenger ? first(r.opponent) : first(r.challenger)
            return (
              <Link
                key={r.id}
                href={`/dashboard/friendlies/${r.id}`}
                className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
              >
                <p className="font-bold text-white">vs {nameOf(opponent)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {r.stake_amount ? `₦${r.stake_amount} stake` : 'Free friendly'} · {r.status}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
