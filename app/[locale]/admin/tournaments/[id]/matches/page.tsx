import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { ROUND_ORDER, ROUND_LABELS } from '@/lib/tournaments/bracket'
import { MatchRow, type AdminMatchRow } from '@/components/admin/MatchRow'
import { ThirdPlaceCreditForm } from '@/components/admin/ThirdPlaceCreditForm'
import { ResolvePendingMatchesButton } from '@/components/admin/ResolvePendingMatchesButton'
import { NoShowBanner, type FlaggedMatchRow } from '@/components/admin/NoShowBanner'
import { buildAdminPlayerWhatsAppUrl, resolvePlayerPhone } from '@/lib/matches/admin-whatsapp'
import { toDateTimeLocal } from '@/lib/format'
import { sideName } from '@/lib/matches/sides'

export const metadata: Metadata = { title: 'Matches · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
// The main match query pulls each player's id + fallback number too, so admin
// can WhatsApp either side of a fixture straight from the row.
type PlayerRef =
  | (ProfileRef & { id: string; whatsapp_number: string | null; country: string | null })
  | null
// A squad side is reached through its captain (a squad has no number of its own).
type SquadRef =
  | { name: string; captain: PlayerRef | PlayerRef[] }
  | { name: string; captain: PlayerRef | PlayerRef[] }[]
  | null
type GroupRef = { name: string } | { name: string }[] | null
function nameOf(p: ProfileRef): string | null {
  return p ? p.display_name ?? p.username ?? 'TBD' : null
}
function groupNameOf(g: GroupRef): string | null {
  return Array.isArray(g) ? g[0]?.name ?? null : g?.name ?? null
}

// Server actions run under this page's route config. Confirming a result or
// closing/publishing a bracket does a long sequential chain (scores, events,
// advancement, notifications) that grows with roster size — a 4v4 final touches
// 8 players. 60 s is the most every Vercel plan allows; the platform default is
// shorter and a timeout here would cut an action off partway through.
export const maxDuration = 60

export default async function AdminMatchesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const [{ data }, { data: regRows }, { data: paidRegs }] = await Promise.all([
    admin
      .from('matches')
      .select(
        'id, round, group_id, status, scheduled_at, is_full_day, youtube_stream_url, replay_url, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, whatsapp_number, country), ' +
          'team_a:squads!matches_team_a_id_fkey(name, captain:profiles!squads_captain_id_fkey(id, username, display_name, whatsapp_number, country)), ' +
          'team_b:squads!matches_team_b_id_fkey(name, captain:profiles!squads_captain_id_fkey(id, username, display_name, whatsapp_number, country)), ' +
          'groups(name)',
      )
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, reg_whatsapp')
      .eq('tournament_id', t.id),
    supabase
      .from('tournament_registrations')
      .select('player_id, profiles!tournament_registrations_player_id_fkey(username, display_name)')
      .eq('tournament_id', t.id)
      .eq('payment_status', 'paid'),
  ])

  // Per-tournament number a player gave at registration — the first choice for
  // reaching them about this tournament's fixtures.
  const regWhatsappByPlayer = new Map(
    ((regRows as { player_id: string; reg_whatsapp: string | null }[] | null) ?? []).map((r) => [
      r.player_id,
      r.reg_whatsapp,
    ]),
  )

  // Candidates for the manual "credit third place" form.
  const thirdPlaceCandidates: { id: string; name: string }[] = ((paidRegs as unknown[] | null) ?? []).map(
    (raw) => {
      const r = raw as { player_id: string; profiles: ProfileRef | ProfileRef[] }
      const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles
      return { id: r.player_id, name: nameOf(p) ?? 'Player' }
    },
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
      team_a: SquadRef
      team_b: SquadRef
      groups: GroupRef
    }
    // One side of the fixture: the display name (null = no competitor, i.e. a
    // bye) and who to WhatsApp about it — the player, or the squad's captain.
    const sideOf = (player: PlayerRef, squad: SquadRef): { name: string | null; contact: PlayerRef } => {
      const sq = Array.isArray(squad) ? squad[0] ?? null : squad
      if (sq) {
        const captain = Array.isArray(sq.captain) ? sq.captain[0] ?? null : sq.captain
        return { name: sq.name, contact: captain }
      }
      return { name: nameOf(player), contact: player }
    }
    const sideA = sideOf(m.player_a, m.team_a)
    const sideB = sideOf(m.player_b, m.team_b)
    const contactInputFor = (player: NonNullable<PlayerRef>) => ({
      regWhatsapp: regWhatsappByPlayer.get(player.id),
      profileWhatsapp: player.whatsapp_number,
      country: player.country,
    })
    const whatsAppUrlFor = (
      side: { name: string | null; contact: PlayerRef },
      opponent: { name: string | null; contact: PlayerRef },
    ): string | null =>
      side.contact &&
      buildAdminPlayerWhatsAppUrl({
        player: contactInputFor(side.contact),
        playerName: nameOf(side.contact) ?? 'there',
        opponentName: opponent.name,
        // So the player can reach their opponent straight from the message.
        opponentPhone: opponent.contact && resolvePlayerPhone(contactInputFor(opponent.contact)),
        tournamentTitle: t.title,
        scheduledAt: m.scheduled_at,
        isFullDay: m.is_full_day,
      })
    return {
      round: m.round,
      groupName: groupNameOf(m.groups),
      row: {
        id: m.id,
        round: m.round,
        playerAName: sideA.name ?? 'TBD',
        playerBName: sideB.name,
        playerAWhatsAppUrl: whatsAppUrlFor(sideA, sideB),
        playerBWhatsAppUrl: whatsAppUrlFor(sideB, sideA),
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
        'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
        'team_a:squads!matches_team_a_id_fkey(name), ' +
        'team_b:squads!matches_team_b_id_fkey(name)',
    )
    .eq('tournament_id', t.id)
    .not('noshow_flagged_at', 'is', null)
    .in('status', ['scheduled', 'live'])

  const flagged: FlaggedMatchRow[] = ((flaggedRaw as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string; round: string; player_a: ProfileRef; player_b: ProfileRef
      team_a: { name: string } | { name: string }[] | null; team_b: { name: string } | { name: string }[] | null
    }
    return {
      id: m.id,
      playerAName: sideName(m.player_a, m.team_a),
      playerBName: sideName(m.player_b, m.team_b),
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
  const thirdPlaceMatch = all.find((x) => x.round === 'third_place')?.row ?? null

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
          {(thirdPlaceMatch || thirdPlaceCandidates.length > 0) && (
            <div>
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Third Place Match
              </h3>
              {thirdPlaceMatch ? (
                <div className="space-y-3">
                  <MatchRow match={thirdPlaceMatch} />
                </div>
              ) : (
                <ThirdPlaceCreditForm tournamentId={t.id} players={thirdPlaceCandidates} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
