import { describe, it, expect, vi } from 'vitest'

const notifyInApp = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
const pushToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer }))

describe('notifyStaff', () => {
  it('notifies every admin/moderator in-app and via push', async () => {
    const inRoles = vi.fn().mockResolvedValue({ data: [{ user_id: 'staff-1' }, { user_id: 'staff-2' }] })
    const selectRoles = vi.fn(() => ({ in: inRoles }))
    const from = vi.fn(() => ({ select: selectRoles }))
    const admin = { from } as unknown as Parameters<typeof import('./staff').notifyStaff>[0]

    const { notifyStaff } = await import('./staff')
    await notifyStaff(admin, 'withdrawal_pending', { title: 'T', body: 'B', link: '/admin/wallet' })

    expect(notifyInApp).toHaveBeenCalledWith({ playerId: 'staff-1', type: 'withdrawal_pending', title: 'T', body: 'B', link: '/admin/wallet' })
    expect(notifyInApp).toHaveBeenCalledWith({ playerId: 'staff-2', type: 'withdrawal_pending', title: 'T', body: 'B', link: '/admin/wallet' })
    expect(pushToPlayer).toHaveBeenCalledWith('staff-1', 'withdrawal_pending', { title: 'T', body: 'B' }, { url: '/admin/wallet' })
    expect(pushToPlayer).toHaveBeenCalledWith('staff-2', 'withdrawal_pending', { title: 'T', body: 'B' }, { url: '/admin/wallet' })
  })

  it('excludes the acting staff member when excludePlayerId is passed', async () => {
    notifyInApp.mockClear()
    pushToPlayer.mockClear()
    const inRoles = vi.fn().mockResolvedValue({ data: [{ user_id: 'staff-1' }, { user_id: 'staff-2' }] })
    const selectRoles = vi.fn(() => ({ in: inRoles }))
    const from = vi.fn(() => ({ select: selectRoles }))
    const admin = { from } as unknown as Parameters<typeof import('./staff').notifyStaff>[0]

    const { notifyStaff } = await import('./staff')
    await notifyStaff(admin, 'result_disputed', { title: 'T', body: 'B', link: '/admin/results' }, 'staff-1')

    expect(notifyInApp).not.toHaveBeenCalledWith(expect.objectContaining({ playerId: 'staff-1' }))
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'staff-2' }))
  })
})
