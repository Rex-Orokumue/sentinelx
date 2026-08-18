import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { noSubmissionNotification } from '@/lib/admin/notification-copy'

type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
type TournamentRef = { title: string } | { title: string }[] | null

function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'Player'
}

// Companion to the `expire-full-day-matches` pg_cron job (which calls
// expire_full_day_matches() directly, unchanged) — that job only flips
// status/auto_expired, it never notifies anyone. This route runs 5 minutes
// later, sweeps for matches it just cancelled, and alerts staff exactly
// once each via full_day_alert_sent_at (same one-shot pattern
// noshow_flagged_at uses for the no-show sweep).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { data } = await admin
    .from('matches')
    .select(
      'id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('is_full_day', true)
    .eq('status', 'cancelled')
    .eq('auto_expired', true)
    .is('full_day_alert_sent_at', null)

  const rows = data ?? []
  for (const m of rows) {
    const tRef = m.tournament as TournamentRef
    const t = Array.isArray(tRef) ? tRef[0] : tRef
    const notification = noSubmissionNotification({
      tournamentTitle: t?.title ?? 'Tournament',
      playerAName: nameOf(m.player_a as NameRef),
      playerBName: nameOf(m.player_b as NameRef),
      createdAt: new Date().toISOString(),
    })
    void notifyStaff(admin, 'result_no_submission', { title: notification.title, body: notification.body, link: notification.link })
    await admin.from('matches').update({ full_day_alert_sent_at: new Date().toISOString() }).eq('id', m.id)
  }

  return Response.json({ notified: rows.length })
}
