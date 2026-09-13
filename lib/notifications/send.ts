import { pushToPlayer } from './push'
import { notifyInAppOf } from './inbox'
import type { NotificationInput } from './copy'
import type { NotificationType } from './inbox'

// Most events go to both the bell and the phone with the same words. Before
// this, call sites wrote the copy out twice — once per channel — which is how
// the two could silently drift apart for the same event, and why translating
// them meant editing every caller.
//
// Both channels render from one NotificationInput, in the recipient's language.
export function notifyBoth(
  playerId: string,
  input: NotificationInput,
  inAppType: NotificationType,
  opts: { link?: string; url?: string; postId?: string | null } = {},
): Promise<void> {
  const url = opts.url ?? opts.link
  return Promise.all([
    notifyInAppOf(playerId, input, inAppType, opts.link),
    pushToPlayer(playerId, input, url ? { url } : {}, { postId: opts.postId }),
  ]).then(() => undefined)
}
