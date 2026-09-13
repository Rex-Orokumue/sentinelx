import { createAdminClient } from '@/lib/supabase/admin'
import { notifyBoth } from '@/lib/notifications/send'
import { deferNotification } from '@/lib/notifications/defer'
import { friendStatusRecipients, type FriendRow } from './status-recipients'

type Admin = ReturnType<typeof createAdminClient>

const COMMUNITY_LINK = '/community'

// A friend posted their first live status. Fans out in-app + push to every
// accepted friend. Wrapped in deferNotification like notifyStaff: it awaits a
// query before reaching notifyBoth, so a `void` caller would be
// frozen mid-query on Vercel with nothing handed to the platform yet.
export function notifyFriendsOfNewStatus(admin: Admin, opts: { authorId: string; authorName: string }): Promise<void> {
  return deferNotification(fanOutNewStatus(admin, opts))
}

async function fanOutNewStatus(admin: Admin, opts: { authorId: string; authorName: string }): Promise<void> {
  try {
    const { data: rows } = await admin
      .from('friends')
      .select('requester_id, recipient_id, status')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${opts.authorId},recipient_id.eq.${opts.authorId}`)

    const recipients = friendStatusRecipients({
      friendRows: (rows ?? []) as FriendRow[],
      authorId: opts.authorId,
    })
    if (recipients.length === 0) return

    await Promise.all(
      recipients.map((id) =>
        notifyBoth(id, { type: 'status_from_friend', authorName: opts.authorName }, 'status_from_friend', {
          link: COMMUNITY_LINK,
        }),
      ),
    )
  } catch (err) {
    console.error('[status-notify] notifyFriendsOfNewStatus failed (non-blocking)', err)
  }
}

// Someone viewed the author's status. One per distinct viewer (the caller only
// invokes this on a genuine status_views insert). Never notifies self.
export function notifyStatusViewed(
  _admin: Admin,
  opts: { authorId: string; viewerId: string; viewerName: string; statusId: string },
): Promise<void> {
  return deferNotification(fanOutStatusViewed(opts))
}

async function fanOutStatusViewed(opts: {
  authorId: string
  viewerId: string
  viewerName: string
  statusId: string
}): Promise<void> {
  if (opts.authorId === opts.viewerId) return
  try {
    await notifyBoth(opts.authorId, { type: 'status_viewed', viewerName: opts.viewerName }, 'status_viewed', {
      link: COMMUNITY_LINK,
    })
  } catch (err) {
    console.error('[status-notify] notifyStatusViewed failed (non-blocking)', err)
  }
}

// A moderator removed the author's status. Always delivered (no pref toggle).
export function notifyStatusRemoved(_admin: Admin, opts: { authorId: string }): Promise<void> {
  return deferNotification(fanOutStatusRemoved(opts))
}

async function fanOutStatusRemoved(opts: { authorId: string }): Promise<void> {
  try {
    await notifyBoth(opts.authorId, { type: 'status_removed' }, 'status_removed', { link: COMMUNITY_LINK })
  } catch (err) {
    console.error('[status-notify] notifyStatusRemoved failed (non-blocking)', err)
  }
}
