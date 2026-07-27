import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from './notify'
import { notifyInApp } from './inbox'
import { fixtureKey } from './keys'
import { formatFixtureDate } from '@/lib/format'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export interface NewFixtureRow {
  id: string
  tournamentId: string
  playerAId: string
  playerBId: string | null // null => bye, skipped — nothing for the player to prepare for
  scheduledAt: string | null
  isFullDay: boolean
}

// Notifies both players of a newly-created (and now-visible) match: in-app
// always, WhatsApp best-effort (currently a no-op until TERMII_API_KEY is
// set, same as every other notify() call in this codebase).
export async function notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void> {
  const real = rows.filter((r): r is NewFixtureRow & { playerBId: string } => r.playerBId != null)
  if (real.length === 0) return

  const playerIds = Array.from(new Set(real.flatMap((r) => [r.playerAId, r.playerBId])))
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, username, display_name')
    .in('id', playerIds)
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))

  const tournamentIds = Array.from(new Set(real.map((r) => r.tournamentId)))
  const { data: tournaments } = await admin.from('tournaments').select('id, title').in('id', tournamentIds)
  const titleByTournament = new Map((tournaments ?? []).map((t) => [t.id, t.title]))

  for (const r of real) {
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
      await notifyInApp({
        playerId: pid,
        type: 'fixture_assigned',
        title: 'New fixture',
        body: `${a} vs ${b} — ${tournament}${whenLabel ? ` · ${whenLabel}` : ''}`,
        link: `/matches/${r.id}`,
      })
    }
  }
}
