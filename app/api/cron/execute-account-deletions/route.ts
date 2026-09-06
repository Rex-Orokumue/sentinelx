import { createAdminClient } from '@/lib/supabase/admin'
import { executeDeletion } from '@/lib/settings/deletion-service'
import { GRACE_DAYS } from '@/lib/settings/grace'
import { sendEmail } from '@/lib/email/send'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const SETTINGS_URL = `${SITE_URL}/dashboard/settings`

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - GRACE_DAYS * DAY_MS).toISOString()

  const { data: due } = await admin
    .from('profiles')
    .select('id')
    .lte('deletion_requested_at', cutoff)
    .is('deleted_at', null)
    .not('deletion_requested_at', 'is', null)

  let executed = 0
  let paused = 0
  for (const row of due ?? []) {
    // Read the email before executeDeletion removes the auth user, so a
    // paused account can still be told why.
    const { data: authUser } = await admin.auth.admin.getUserById(row.id)
    const email = authUser?.user?.email ?? null

    const result = await executeDeletion(admin, row.id)
    if (result.ok) {
      executed++
      continue
    }
    // Paused, not cancelled and not silently dropped: the pending state
    // stands so tomorrow's run retries, and the user is told why. A referral
    // credit landing mid-grace is the realistic cause.
    paused++
    console.error('deletion paused by guards', row.id, result.blockers)
    if (email) {
      await sendEmail({
        to: email,
        subject: 'Your SentinelX account deletion is on hold',
        html:
          '<p>We could not complete your account deletion because something is still ' +
          'outstanding on your account.</p>' +
          `<p>Sign in to review it — we will try again daily: ` +
          `<a href="${SETTINGS_URL}">${SETTINGS_URL}</a></p>`,
      })
    }
  }

  // Reminder at 3 days remaining, i.e. requested 12 days ago. Windowed to a
  // single day so a daily run sends it exactly once, without needing a
  // "reminded" column.
  const remindFrom = new Date(Date.now() - 13 * DAY_MS).toISOString()
  const remindTo = new Date(Date.now() - 12 * DAY_MS).toISOString()
  const { data: reminders } = await admin
    .from('profiles')
    .select('id')
    .gte('deletion_requested_at', remindFrom)
    .lt('deletion_requested_at', remindTo)
    .is('deleted_at', null)

  let reminded = 0
  for (const row of reminders ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(row.id)
    const email = authUser?.user?.email
    if (!email) continue
    await sendEmail({
      to: email,
      subject: 'Your SentinelX account will be deleted in 3 days',
      html:
        '<p>Your SentinelX Esports account is scheduled for deletion in 3 days.</p>' +
        `<p>If you want to keep it, sign in and cancel: ` +
        `<a href="${SETTINGS_URL}">${SETTINGS_URL}</a></p>`,
    })
    reminded++
  }

  return Response.json({ due: due?.length ?? 0, executed, paused, reminded })
}
