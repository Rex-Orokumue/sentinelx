import { createAdminClient } from '@/lib/supabase/admin'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { deferNotification } from '@/lib/notifications/defer'
import { friendStatusRecipients, type FriendRow } from './status-recipients'

type Admin = ReturnType<typeof createAdminClient>

const COMMUNITY_LINK = '/community'

// A friend posted their first live status. Fans out in-app + push to every
// accepted friend. Wrapped in deferNotification like notifyStaff: it awaits a
// query before reaching notifyInApp/pushToPlayer, so a `void` caller would be
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

    const title = 'New status'
    const body = `${opts.authorName} added to their status.`
    await Promise.all(
      recipients.flatMap((id) => [
        notifyInApp({ playerId: id, type: 'status_from_friend', title, body, link: COMMUNITY_LINK }),
        pushToPlayer(id, { type: 'status_from_friend', authorName: opts.authorName }, { url: COMMUNITY_LINK }),
      ]),
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
    const title = 'Status viewed'
    const body = `${opts.viewerName} viewed your status.`
    await Promise.all([
      notifyInApp({ playerId: opts.authorId, type: 'status_viewed', title, body, link: COMMUNITY_LINK }),
      pushToPlayer(opts.authorId, { type: 'status_viewed', viewerName: opts.viewerName }, { url: COMMUNITY_LINK }),
    ])
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
    const title = 'Status removed'
    const body = 'A moderator removed your status.'
    await Promise.all([
      notifyInApp({ playerId: opts.authorId, type: 'status_removed', title, body, link: COMMUNITY_LINK }),
      pushToPlayer(opts.authorId, { type: 'status_removed' }, { url: COMMUNITY_LINK }),
    ])
  } catch (err) {
    console.error('[status-notify] notifyStatusRemoved failed (non-blocking)', err)
  }
}
