import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { reminderKey } from '@/lib/notifications/keys'
import { isWithinReminderWindow } from '@/lib/notifications/window'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type NameRef =
  | { display_name: string | null; username: string | null }
  | { display_name: string | null; username: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
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
  player_a: NameRef
  player_b: NameRef
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
      'id, scheduled_at, player_a_id, player_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
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
    if (!m.player_a_id || !m.player_b_id) continue
    const a = nameOf(m.player_a)
    const b = nameOf(m.player_b)
    const tournament = titleOf(m.tournament)
    const matchUrl = `${SITE_URL}/matches/${m.id}`
    for (const pid of [m.player_a_id, m.player_b_id]) {
      await notify({
        type: 'fixture_reminder',
        playerId: pid,
        dedupeKey: reminderKey(m.id, pid),
        playerA: a,
        playerB: b,
        tournament,
        matchUrl,
      })
      reminded += 1
    }
  }

  return Response.json({ reminded })
}
