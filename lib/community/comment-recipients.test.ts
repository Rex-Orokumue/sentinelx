import { describe, it, expect } from 'vitest'
import { commentNotificationRecipients } from './comment-recipients'

const base = {
  postAuthorId: null as string | null,
  matchPlayerIds: [] as (string | null)[],
  staffIds: [] as string[],
  commenterId: 'commenter-1',
}

describe('commentNotificationRecipients — authored posts', () => {
  it('notifies the author of a manual post', () => {
    expect(
      commentNotificationRecipients({ ...base, postType: 'manual', postAuthorId: 'author-1' }),
    ).toEqual(['author-1'])
  })

  it('notifies nobody when the author comments on their own post', () => {
    expect(
      commentNotificationRecipients({ ...base, postType: 'manual', postAuthorId: 'commenter-1' }),
    ).toEqual([])
  })

  it('notifies the author of an achievement post', () => {
    expect(
      commentNotificationRecipients({ ...base, postType: 'achievement', postAuthorId: 'author-1' }),
    ).toEqual(['author-1'])
  })
})

// THE BUG: match_result posts are system-generated and every one of the 116
// in production has author_id NULL. The old guard was
// `if (post?.author_id && ...)`, so a null author meant the entire block was
// skipped — no push AND no in-app notification. That is 87% of all posts, and
// it is exactly the content players engage with.
describe('commentNotificationRecipients — match results', () => {
  it('notifies both players in the match', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'match_result',
        matchPlayerIds: ['player-a', 'player-b'],
      }),
    ).toEqual(['player-a', 'player-b'])
  })

  it('does not notify a player who is the one commenting', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'match_result',
        matchPlayerIds: ['commenter-1', 'player-b'],
      }),
    ).toEqual(['player-b'])
  })

  // A bye or an unplayed slot leaves one side null.
  it('skips null player slots', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'match_result',
        matchPlayerIds: ['player-a', null],
      }),
    ).toEqual(['player-a'])
  })

  it('never notifies the same player twice', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'match_result',
        matchPlayerIds: ['player-a', 'player-a'],
      }),
    ).toEqual(['player-a'])
  })

  it('notifies nobody when the match could not be resolved', () => {
    expect(
      commentNotificationRecipients({ ...base, postType: 'match_result', matchPlayerIds: [] }),
    ).toEqual([])
  })
})

describe('commentNotificationRecipients — announcements', () => {
  it('notifies staff, since an announcement has no author', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'announcement',
        staffIds: ['admin-1', 'mod-1'],
      }),
    ).toEqual(['admin-1', 'mod-1'])
  })

  it('does not notify the staff member who commented', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'announcement',
        staffIds: ['commenter-1', 'admin-2'],
      }),
    ).toEqual(['admin-2'])
  })

  // Announcements are broadcast; the players are not the subject of the post,
  // so a comment on one is staff business only.
  it('ignores match players on an announcement', () => {
    expect(
      commentNotificationRecipients({
        ...base,
        postType: 'announcement',
        staffIds: ['admin-1'],
        matchPlayerIds: ['player-a'],
      }),
    ).toEqual(['admin-1'])
  })
})
