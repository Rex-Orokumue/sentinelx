import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { notifyBoth } from '@/lib/notifications/send'
import { reminderKey } from '@/lib/notifications/keys'
import { isWithinReminderWindow } from '@/lib/notifications/window'
import { SITE_URL } from '@/lib/seo/site'
import { matchRosters } from '@/lib/tournaments/squad-roster'

type NameRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
}
type SquadRef = { name: string } | { name: string }[] | null
function squadNameOf(x: SquadRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.name ?? 'Squad'
}
type TitleRef = { title: string } | { title: string }[] | null
function titleOf(x: TitleRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? 'the tournament'
}

type ReminderRow = {
  id: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: TitleRef
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const horizon = new Date(now.getTime() + 65 * 60_000).toISOString()

  const { data } = await admin
    .from('matches')
    .select(
      'id, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'team_a:squads!matches_team_a_id_fkey(name), ' +
        'team_b:squads!matches_team_b_id_fkey(name), ' +
        'tournament:tournaments(title)',
    )
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon)

  const rows = (data ?? []) as unknown as ReminderRow[]
  let reminded = 0
  for (const m of rows) {
    if (!isWithinReminderWindow(m.scheduled_at, now)) continue
    const isTeam = !!(m.team_a_id || m.team_b_id)
    if (!isTeam && (!m.player_a_id || !m.player_b_id)) continue
    if (isTeam && (!m.team_a_id || !m.team_b_id)) continue

    const a = isTeam ? squadNameOf(m.team_a) : nameOf(m.player_a)
    const b = isTeam ? squadNameOf(m.team_b) : nameOf(m.player_b)
    const tournament = titleOf(m.tournament)
    const matchUrl = `${SITE_URL}/matches/${m.id}`

    if (isTeam) {
      const { rosterA, rosterB } = await matchRosters(admin, m.team_a_id, m.team_b_id)
      const rosterASet = new Set(rosterA)
      for (const pid of [...rosterA, ...rosterB]) {
        await notify({ type: 'fixture_reminder', playerId: pid, dedupeKey: reminderKey(m.id, pid), playerA: a, playerB: b, tournament, matchUrl })
        const opponent = rosterASet.has(pid) ? b : a
        void notifyBoth(pid, { type: 'match_reminder', tournament, opponent }, 'match_reminder', { link: matchUrl })
        reminded += 1
      }
      continue
    }

    for (const pid of [m.player_a_id as string, m.player_b_id as string]) {
      await notify({ type: 'fixture_reminder', playerId: pid, dedupeKey: reminderKey(m.id, pid), playerA: a, playerB: b, tournament, matchUrl })
      const opponent = pid === m.player_a_id ? b : a
      void notifyBoth(pid, { type: 'match_reminder', tournament, opponent }, 'match_reminder', { link: matchUrl })
      reminded += 1
    }
  }

  return Response.json({ reminded })
}
