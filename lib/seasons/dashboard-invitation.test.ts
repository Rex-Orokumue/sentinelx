import { expect, it } from 'vitest'
import { selectActionableInvitation } from './dashboard-invitation'

const tournament = { title: 'Masters Cup', slug: 'masters', registration_fee: 500 }
const invitation = { id: 'i1', tournament_id: 't1', status: 'pending', expires_at: '2026-10-26T00:00:00Z', rank_at_invite: 3, tournament }
const now = new Date('2026-10-25T00:00:00Z')

it('shows a pending invite before its deadline', () => {
  expect(selectActionableInvitation([invitation], [], now)?.id).toBe('i1')
})

it('keeps an accepted unpaid invite visible after its response deadline', () => {
  expect(selectActionableInvitation([{ ...invitation, status: 'accepted', expires_at: '2026-10-24T00:00:00Z' }], [{ tournament_id: 't1', payment_status: 'pending' }], now)?.id).toBe('i1')
})

it('hides an expired pending invite and a paid accepted invite', () => {
  expect(selectActionableInvitation([{ ...invitation, expires_at: '2026-10-24T00:00:00Z' }], [], now)).toBeNull()
  expect(selectActionableInvitation([{ ...invitation, status: 'accepted' }], [{ tournament_id: 't1', payment_status: 'paid' }], now)).toBeNull()
})
