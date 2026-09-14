import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from './notify'
import { notifyBoth } from './send'
import { fixtureKey } from './keys'
import { formatFixtureDate } from '@/lib/format'
import { SITE_URL } from '@/lib/seo/site'
import { matchRosters } from '@/lib/tournaments/squad-roster'

type Admin = ReturnType<typeof createAdminClient>

export interface NewFixtureRow {
  id: string
  tournamentId: string
  playerAId: string
  playerBId: string | null // null => bye, skipped — nothing for the player to prepare for
  // A team fixture's squad ids. Optional and only ever set together — a row
  // is either a player fixture (playerAId/playerBId) or a team fixture
  // (teamAId/teamBId), never both (matches_side_a_kind/matches_side_b_kind
  // guarantee this at the DB level, mirrored here for callers building rows
  // from a matches select).
  teamAId?: string | null
  teamBId?: string | null
  scheduledAt: string | null
  isFullDay: boolean
}

// Notifies every player of a newly-created (and now-visible) match: in-app
// always, WhatsApp best-effort (currently a no-op until TERMII_API_KEY is
// set, same as every other notify() call in this codebase). Solo rows notify
// the two named players; team rows notify every current member of both
// squads' rosters.
export async function notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void> {
  const solo = rows.filter((r): r is NewFixtureRow & { playerBId: string } => r.playerAId != null && r.playerBId != null)
  const team = rows.filter((r): r is NewFixtureRow & { teamAId: string; teamBId: string } => r.teamAId != null && r.teamBId != null)
  if (solo.length === 0 && team.length === 0) return

  if (solo.length > 0) {
    const playerIds = Array.from(new Set(solo.flatMap((r) => [r.playerAId, r.playerBId])))
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username, display_name')
      .in('id', playerIds)
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))

    const tournamentIds = Array.from(new Set(solo.map((r) => r.tournamentId)))
    const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
    const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

    for (const r of solo) {
      const a = nameById.get(r.playerAId) ?? 'Player'
      const b = nameById.get(r.playerBId) ?? 'Player'
      const tournament = titleByTournament.get(r.tournamentId) ?? 'Sentinel X'
      const matchUrl = `${SITE_URL}/matches/${r.id}`
      const whenLabel = formatFixtureDate(r.scheduledAt, r.isFullDay)
      for (const pid of [r.playerAId, r.playerBId]) {
        await notify({
          type: 'fixture_assigned',
          playerId: pid,
          dedupeKey: fixtureKey(r.id, pid),
          playerA: a,
          playerB: b,
          tournament,
          matchUrl,
          whenLabel,
        })
        void notifyBoth(pid, { type: 'fixture_new', playerA: a, playerB: b, tournament }, 'fixture_assigned', {
          link: `/matches/${r.id}`,
        })
      }
    }
  }

  if (team.length > 0) {
    const squadIds = Array.from(new Set(team.flatMap((r) => [r.teamAId, r.teamBId])))
    const { data: squads } = await admin.from('squads').select('id, name').in('id', squadIds)
    const nameBySquad = new Map((squads ?? []).map((s) => [s.id, s.name]))

    const tournamentIds = Array.from(new Set(team.map((r) => r.tournamentId)))
    const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
    const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

    for (const r of team) {
      const { rosterA, rosterB } = await matchRosters(admin, r.teamAId, r.teamBId)
      const a = nameBySquad.get(r.teamAId) ?? 'Squad'
      const b = nameBySquad.get(r.teamBId) ?? 'Squad'
      const tournament = titleByTournament.get(r.tournamentId) ?? 'Sentinel X'
      const matchUrl = `${SITE_URL}/matches/${r.id}`
      const whenLabel = formatFixtureDate(r.scheduledAt, r.isFullDay)
      for (const pid of [...rosterA, ...rosterB]) {
        await notify({
          type: 'fixture_assigned',
          playerId: pid,
          dedupeKey: fixtureKey(r.id, pid),
          playerA: a,
          playerB: b,
          tournament,
          matchUrl,
          whenLabel,
        })
        void notifyBoth(pid, { type: 'fixture_new', playerA: a, playerB: b, tournament }, 'fixture_assigned', {
          link: `/matches/${r.id}`,
        })
      }
    }
  }
}
