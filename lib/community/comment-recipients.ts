import type { PostType } from './feed-query'

// Who should hear about a new comment.
//
// Previously this was a single inline guard, `if (post?.author_id && ...)`,
// which silently notified nobody whenever a post had no author. Every
// match_result post is system-generated with author_id NULL — 116 of them,
// 87% of the feed — so commenting on the content players actually engage with
// notified no one at all, by push or in-app. Announcements are author-less
// for the same reason.
//
// The commenter is always excluded: nobody needs telling about their own
// comment.
export function commentNotificationRecipients(input: {
  postType: PostType
  postAuthorId: string | null
  // Both sides of the referenced match, for match_result posts. A bye or an
  // unplayed slot leaves one null.
  matchPlayerIds: (string | null)[]
  // Admins and moderators, for announcements.
  staffIds: string[]
  commenterId: string
}): string[] {
  const candidates: (string | null)[] =
    input.postType === 'match_result'
      ? input.matchPlayerIds
      : input.postType === 'announcement'
        ? input.staffIds
        : [input.postAuthorId]

  const seen = new Set<string>()
  const recipients: string[] = []
  for (const id of candidates) {
    if (!id || id === input.commenterId || seen.has(id)) continue
    seen.add(id)
    recipients.push(id)
  }
  return recipients
}
