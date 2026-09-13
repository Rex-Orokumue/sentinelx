import type { Translate } from './locale'
import type { PushNotificationType } from './push-types'

// Every piece of push / in-app notification wording, in one place.
//
// Before this, each call site built its own `{ title, body }` inline — 20-odd
// files, with several messages written out twice because the same words went to
// both the push and the bell (lib/wagers/settle.ts was the clearest case). That
// made translation impossible without touching every caller, and it meant two
// channels could drift apart for the same event.
//
// Call sites now pass the EVENT and its values; the sender renders it, in the
// recipient's language. See push.ts / inbox.ts for where the locale is
// resolved.

export type NotificationInput =
  | { type: 'achievement_unlocked'; name: string; xp: number; coins: number }
  | { type: 'challenge_completed'; challenge: string; coins: number; xp: number }
  | { type: 'new_announcement'; excerpt: string }
  | { type: 'post_comment'; onMatch: boolean; excerpt: string }
  | { type: 'post_reaction'; onMatch: boolean; reaction: string }
  | { type: 'status_from_friend'; authorName: string }
  | { type: 'status_viewed'; viewerName: string }
  | { type: 'status_removed' }
  | { type: 'result_submitted'; scoreline: string; tournament: string; isResubmission: boolean }
  | { type: 'noshow_needs_decision'; tournament: string; playerA: string; playerB: string }
  | {
      type: 'result_confirmed'
      playerA: string
      scoreA: number
      scoreB: number
      playerB: string
      tournament: string
    }
  | { type: 'fixture_new'; playerA: string; playerB: string; tournament: string }
  | { type: 'fixture_updated'; round: string; opponent: string | null }
  | { type: 'referral_converted'; referredName: string; coins: number }
  | { type: 'tournament_announced'; tournament: string }
  | { type: 'bracket_released'; tournament: string }
  | { type: 'wager_settled'; won: boolean; payout: number; stake: number }
  | { type: 'prize_credited'; amount: string }
  | { type: 'match_reminder'; tournament: string; opponent: string }

export interface RenderedNotification {
  title: string
  body: string
}

// Which pref/mute key an event answers to. Several events deliberately share
// one: a new fixture and a rearranged fixture are both 'match_assigned' to
// anyone opting out, even though they read differently.
const PUSH_TYPE: Record<NotificationInput['type'], PushNotificationType> = {
  achievement_unlocked: 'achievement_unlocked',
  challenge_completed: 'challenge_completed',
  new_announcement: 'new_announcement',
  post_comment: 'post_comment',
  post_reaction: 'post_reaction',
  status_from_friend: 'status_from_friend',
  status_viewed: 'status_viewed',
  status_removed: 'status_removed',
  result_submitted: 'result_submitted',
  noshow_needs_decision: 'noshow_needs_decision',
  result_confirmed: 'result_confirmed',
  fixture_new: 'match_assigned',
  fixture_updated: 'match_assigned',
  referral_converted: 'referral_converted',
  tournament_announced: 'tournament_announced',
  bracket_released: 'bracket_released',
  wager_settled: 'wager_settled',
  prize_credited: 'prize_credited',
  match_reminder: 'match_reminder',
}

export function pushTypeFor(input: NotificationInput): PushNotificationType {
  return PUSH_TYPE[input.type]
}

// `t` must already be bound to the recipient's locale and the
// `notifications.push` namespace.
export function renderNotification(input: NotificationInput, t: Translate): RenderedNotification {
  switch (input.type) {
    case 'achievement_unlocked':
      return {
        title: t('achievementUnlocked.title'),
        body: t('achievementUnlocked.body', { name: input.name, xp: input.xp, coins: input.coins }),
      }
    case 'challenge_completed':
      return {
        title: t('challengeCompleted.title'),
        body: t('challengeCompleted.body', {
          challenge: input.challenge,
          coins: input.coins,
          xp: input.xp,
        }),
      }
    case 'new_announcement':
      return {
        title: t('newAnnouncement.title'),
        body: t('newAnnouncement.body', { excerpt: input.excerpt }),
      }
    case 'post_comment':
      // Two titles rather than one with a conditional: "on your match" is a
      // different sentence in other languages, not an appended clause.
      return {
        title: input.onMatch ? t('postComment.titleMatch') : t('postComment.title'),
        body: t('postComment.body', { excerpt: input.excerpt }),
      }
    case 'post_reaction':
      return {
        title: input.onMatch ? t('postReaction.titleMatch') : t('postReaction.title'),
        body: t('postReaction.body', { reaction: input.reaction }),
      }
    case 'status_from_friend':
      return {
        title: t('statusFromFriend.title'),
        body: t('statusFromFriend.body', { authorName: input.authorName }),
      }
    case 'status_viewed':
      return {
        title: t('statusViewed.title'),
        body: t('statusViewed.body', { viewerName: input.viewerName }),
      }
    case 'status_removed':
      return { title: t('statusRemoved.title'), body: t('statusRemoved.body') }
    case 'result_submitted':
      return {
        title: input.isResubmission ? t('resultSubmitted.titleAgain') : t('resultSubmitted.title'),
        body: input.isResubmission
          ? t('resultSubmitted.bodyAgain', { scoreline: input.scoreline, tournament: input.tournament })
          : t('resultSubmitted.body', { scoreline: input.scoreline, tournament: input.tournament }),
      }
    case 'noshow_needs_decision':
      return {
        title: t('noshowNeedsDecision.title'),
        body: t('noshowNeedsDecision.body', {
          tournament: input.tournament,
          playerA: input.playerA,
          playerB: input.playerB,
        }),
      }
    case 'result_confirmed':
      return {
        title: t('resultConfirmed.title'),
        body: t('resultConfirmed.body', {
          playerA: input.playerA,
          scoreA: input.scoreA,
          scoreB: input.scoreB,
          playerB: input.playerB,
          tournament: input.tournament,
        }),
      }
    case 'fixture_new':
      return {
        title: t('fixtureNew.title'),
        body: t('fixtureNew.body', {
          playerA: input.playerA,
          playerB: input.playerB,
          tournament: input.tournament,
        }),
      }
    case 'fixture_updated':
      return {
        title: t('fixtureUpdated.title'),
        body: input.opponent
          ? t('fixtureUpdated.body', { round: input.round, opponent: input.opponent })
          : t('fixtureUpdated.bodyBye', { round: input.round }),
      }
    case 'referral_converted':
      return {
        title: t('referralConverted.title'),
        body: t('referralConverted.body', { referredName: input.referredName, coins: input.coins }),
      }
    case 'tournament_announced':
      return {
        title: t('tournamentAnnounced.title'),
        body: t('tournamentAnnounced.body', { tournament: input.tournament }),
      }
    case 'bracket_released':
      return {
        title: t('bracketReleased.title'),
        body: t('bracketReleased.body', { tournament: input.tournament }),
      }
    case 'wager_settled':
      return {
        title: input.won ? t('wagerSettled.titleWon') : t('wagerSettled.title'),
        body: input.won
          ? t('wagerSettled.bodyWon', { payout: input.payout })
          : t('wagerSettled.bodyLost', { stake: input.stake }),
      }
    case 'prize_credited':
      return {
        title: t('prizeCredited.title'),
        body: t('prizeCredited.body', { amount: input.amount }),
      }
    case 'match_reminder':
      return {
        title: t('matchReminder.title'),
        body: t('matchReminder.body', { tournament: input.tournament, opponent: input.opponent }),
      }
  }
}
