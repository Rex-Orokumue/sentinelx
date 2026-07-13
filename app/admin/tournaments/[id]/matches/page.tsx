import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { ROUND_ORDER, ROUND_LABELS } from '@/lib/tournaments/bracket'
import { MatchRow, type AdminMatchRow } from '@/components/admin/MatchRow'
import { toDateTimeLocal } from '@/lib/format'

export const metadata: Metadata = { title: 'Matches · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
type GroupRef = { name: string } | { name: string }[] | null
function nameOf(p: ProfileRef): string | null {
  return p ? p.display_name ?? p.username ?? 'TBD' : null
}
function groupNameOf(g: GroupRef): string | null {
  return Array.isArray(g) ? g[0]?.name ?? null : g?.name ?? null
}

export default async function AdminMatchesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'groups(name)',
    )
    .eq('tournament_id', t.id)

  const all = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      youtube_stream_url: string | null
      replay_url: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      groups: GroupRef
    }
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        playerAName: nameOf(m.player_a) ?? 'TBD',
        playerBName: nameOf(m.player_b),
        status: m.status,
        scheduledAt: toDateTimeLocal(m.scheduled_at),
        isFullDay: m.is_full_day,
        streamUrl: m.youtube_stream_url ?? '',
        replayUrl: m.replay_url ?? '',
      } as AdminMatchRow,
    }
  })

  const groupMatches = all.filter((x) => x.round === 'group')
  const groupNames = Array.from(
    new Set(groupMatches.map((x) => x.groupName).filter(Boolean)),
  ).sort() as string[]
  const groupSections = groupNames.map((gn) => ({
    label: gn,
    rows: groupMatches.filter((x) => x.groupName === gn).map((x) => x.row),
  }))
  const knockoutSections = ROUND_ORDER.map((r) => ({
    label: ROUND_LABELS[r] ?? r,
    rows: all.filter((x) => x.round === r).map((x) => x.row),
  })).filter((s) => s.rows.length > 0)
  const sections = [...groupSections, ...knockoutSections]

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Matches</h2>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No matches yet.{' '}
          <Link href={`/admin/tournaments/${t.id}/bracket`} className="text-violet-400">
            Generate the bracket first.
          </Link>
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.label}>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {s.label}
              </h3>
              <div className="space-y-3">
                {s.rows.map((row) => (
                  <MatchRow key={row.id} match={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
