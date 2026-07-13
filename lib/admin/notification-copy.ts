import { formatNaira } from '@/lib/format'

export type AdminNotificationType =
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'withdrawal_pending'
  | 'referral_withdrawal_pending'
  | 'friendly_withdrawal_pending'

export interface AdminNotificationItem {
  type: AdminNotificationType
  title: string
  body: string
  link: string
  createdAt: string
}

// MERGE DEPENDENCY — #28 (feat/28-30-wallet-perks-recordings): when that
// branch merges, withdrawal_pending's link changes from '/admin/withdrawals'
// to '/admin/wallet' (withdrawal_requests survives with widened scope), and
// the referral_withdrawal_pending / friendly_withdrawal_pending entries below
// are deleted entirely (their source tables are dropped). See
// lib/admin/notification-queue.ts for the matching query-side change.
const TYPE_LINK: Record<AdminNotificationType, string> = {
  exchange_listing_pending: '/admin/exchange',
  result_needs_review: '/admin/results',
  result_disputed: '/admin/results',
  withdrawal_pending: '/admin/withdrawals',
  referral_withdrawal_pending: '/admin/referrals',
  friendly_withdrawal_pending: '/admin/friendly-withdrawals',
}

export function exchangeListingNotification(row: {
  title: string
  sellerName: string
  createdAt: string
}): AdminNotificationItem {
  return {
    type: 'exchange_listing_pending',
    title: 'Listing pending review',
    body: `${row.title} — ${row.sellerName}`,
    link: TYPE_LINK.exchange_listing_pending,
    createdAt: row.createdAt,
  }
}

const RESULT_TITLE: Record<'result_needs_review' | 'result_disputed', string> = {
  result_needs_review: 'Result needs review',
  result_disputed: 'Result disputed',
}

export function resultNotification(row: {
  type: 'result_needs_review' | 'result_disputed'
  tournamentTitle: string
  playerAName: string
  playerBName: string
  createdAt: string
}): AdminNotificationItem {
  return {
    type: row.type,
    title: RESULT_TITLE[row.type],
    body: `${row.tournamentTitle} — ${row.playerAName} vs ${row.playerBName}`,
    link: TYPE_LINK[row.type],
    createdAt: row.createdAt,
  }
}

const WITHDRAWAL_TITLE: Record<
  'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending',
  string
> = {
  withdrawal_pending: 'Withdrawal request',
  referral_withdrawal_pending: 'Referral withdrawal',
  friendly_withdrawal_pending: 'Friendly withdrawal',
}

export function withdrawalNotification(row: {
  type: 'withdrawal_pending' | 'referral_withdrawal_pending' | 'friendly_withdrawal_pending'
  username: string
  amount: number
  createdAt: string
}): AdminNotificationItem {
  return {
    type: row.type,
    title: WITHDRAWAL_TITLE[row.type],
    body: `${row.username} — ${formatNaira(row.amount)}`,
    link: TYPE_LINK[row.type],
    createdAt: row.createdAt,
  }
}

export function sortByCreatedAtDesc(items: AdminNotificationItem[]): AdminNotificationItem[] {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function countByHref(items: AdminNotificationItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    counts[item.link] = (counts[item.link] ?? 0) + 1
  }
  return counts
}
