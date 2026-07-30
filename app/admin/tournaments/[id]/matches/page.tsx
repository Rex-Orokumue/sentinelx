import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { ROUND_ORDER, ROUND_LABELS } from '@/lib/tournaments/bracket'
import { MatchRow, type AdminMatchRow } from '@/components/admin/MatchRow'
import { ResolvePendingMatchesButton } from '@/components/admin/ResolvePendingMatchesButton'
import { NoShowBanner, type FlaggedMatchRow } from '@/components/admin/NoShowBanner'
import { buildAdminPlayerWhatsAppUrl, resolvePlayerPhone } from '@/lib/matches/admin-whatsapp'
import { toDateTimeLocal } from '@/lib/format'

export const metadata: Metadata = { title: 'Matches · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
// The main match query pulls each player's id + fallback number too, so admin
// can WhatsApp either side of a fixture straight from the row.
type PlayerRef =
  | (ProfileRef & { id: string; whatsapp_number: string | null; country: string | null })
  | null
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

  const [{ data }, { data: regRows }] = await Promise.all([
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'groups(name)',
      )
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, reg_whatsapp')
      .eq('tournament_id', t.id),
  ])

  // Per-tournament number a player gave at registration — the first choice for
  // reaching them about this tournament's fixtures.
  const regWhatsappByPlayer = new Map(
    ((regRows as { player_id: string; reg_whatsapp: string | null }[] | null) ?? []).map((r) => [
      r.player_id,
      r.reg_whatsapp,
    ]),
  )

  const all = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      scheduled_at: string | null
      is_full_day: boolean
      youtube_stream_url: string | null
      replay_url: string | null
      player_a: PlayerRef
      player_b: PlayerRef
      groups: GroupRef
    }
    const contactInputFor = (player: NonNullable<PlayerRef>) => ({
      regWhatsapp: regWhatsappByPlayer.get(player.id),
      profileWhatsapp: player.whatsapp_number,
      country: player.country,
    })
    const whatsAppUrlFor = (player: PlayerRef, opponent: PlayerRef): string | null =>
      player &&
      buildAdminPlayerWhatsAppUrl({
        player: contactInputFor(player),
        playerName: nameOf(player) ?? 'there',
        opponentName: nameOf(opponent),
        // So the player can reach their opponent straight from the message.
        opponentPhone: opponent && resolvePlayerPhone(contactInputFor(opponent)),
        tournamentTitle: t.title,
        scheduledAt: m.scheduled_at,
        isFullDay: m.is_full_day,
      })
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        playerAName: nameOf(m.player_a) ?? 'TBD',
        playerBName: nameOf(m.player_b),
        playerAWhatsAppUrl: whatsAppUrlFor(m.player_a, m.player_b),
        playerBWhatsAppUrl: whatsAppUrlFor(m.player_b, m.player_a),
        status: m.status,
        scheduledAt: toDateTimeLocal(m.scheduled_at),
        isFullDay: m.is_full_day,
        streamUrl: m.youtube_stream_url ?? '',
        replayUrl: m.replay_url ?? '',
      } as AdminMatchRow,
    }
  })

  const { data: flaggedRaw } = await supabase
    .from('matches')
    .select(
      'id, round, ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('tournament_id', t.id)
    .not('noshow_flagged_at', 'is', null)
    .in('status', ['scheduled', 'live'])

  const flagged: FlaggedMatchRow[] = ((flaggedRaw as unknown[] | null) ?? []).map((raw) => {
    const m = raw as { id: string; round: string; player_a: ProfileRef; player_b: ProfileRef }
    return {
      id: m.id,
      playerAName: nameOf(m.player_a) ?? 'TBD',
      playerBName: nameOf(m.player_b) ?? 'TBD',
      round: m.round,
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
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-white">{t.title} · Matches</h2>
        <ResolvePendingMatchesButton tournamentId={t.id} />
      </div>

      <NoShowBanner matches={flagged} />

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
