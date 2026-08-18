import { createAdminClient } from '@/lib/supabase/admin'
import { notifyInApp, type NotificationType } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'

type Admin = ReturnType<typeof createAdminClient>

// Profile ids for every admin/moderator with a WhatsApp number on file — the
// recipient list for staff-facing alerts (e.g. a no-show that needs a
// decision). A staff member with no verified WhatsApp number is silently
// skipped, same as notify()'s existing "no recipient -> stays skipped"
// behavior — they'll still see the in-app admin notification bell.
export async function getNotifiableStaffIds(admin: Admin): Promise<string[]> {
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role', ['admin', 'moderator'])
  const staffIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
  if (staffIds.length === 0) return []

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, whatsapp_number')
    .in('id', staffIds)
    .not('whatsapp_number', 'is', null)
  return (profiles ?? []).map((p) => p.id)
}

// Every admin/moderator profile id, regardless of WhatsApp number — the
// recipient list for push+in-app-only staff alerts (notifyStaff below).
// Unlike getNotifiableStaffIds, no WhatsApp gate: pushToPlayer and
// notifyInApp already no-op per-recipient (no FCM token, opted out, etc.),
// so there's no reason to pre-filter here.
export async function getStaffIds(admin: Admin): Promise<string[]> {
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role', ['admin', 'moderator'])
  return Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
}

// Fan-out for admin-facing events that only need tiers 1+2 (in-app + FCM
// push) — no WhatsApp. `type` must already be a member of both the in-app
// NotificationType union (inbox.ts) and PushNotificationType (push-types.ts);
// TypeScript enforces that at the call site via the intersection below.
// `excludePlayerId` skips notifying the staff member who caused the event
// themselves (e.g. the admin who just disputed a result).
export async function notifyStaff(
  admin: Admin,
  type: Extract<NotificationType, 'withdrawal_pending' | 'exchange_listing_pending' | 'result_needs_review' | 'result_disputed' | 'result_no_submission'>,
  payload: { title: string; body: string; link: string },
  excludePlayerId?: string,
): Promise<void> {
  try {
    const staffIds = (await getStaffIds(admin)).filter((id) => id !== excludePlayerId)
    for (const staffId of staffIds) {
      void notifyInApp({ playerId: staffId, type, title: payload.title, body: payload.body, link: payload.link })
      void pushToPlayer(staffId, type, { title: payload.title, body: payload.body }, { url: payload.link })
    }
  } catch (err) {
    console.error('[staff] notifyStaff failed (non-blocking)', { type, err })
  }
}
