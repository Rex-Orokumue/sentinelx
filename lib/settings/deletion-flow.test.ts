import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./deletion-service', () => ({ fetchGuardInput: vi.fn(), executeDeletion: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))

import { fetchGuardInput, executeDeletion } from './deletion-service'
import { sendEmail } from '@/lib/email/send'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from './deletion-flow'

const clean = { walletBalance: 0, pendingWithdrawals: 0, openEscrowOrders: 0, activeListings: 0, activeTournaments: 0, unfinishedMatches: 0, unfinishedFriendlies: 0 }

function adminWith(opts: { updateError?: boolean; username?: string | null; onUpdate?: (patch: unknown) => void; onIs?: (col: string, v: unknown) => void } = {}) {
  return {
    from: () => ({
      update: (patch: unknown) => {
        opts.onUpdate?.(patch)
        const result = { error: opts.updateError ? { message: 'x' } : null }
        const chain = {
          eq: () => chain,
          is: (col: string, v: unknown) => { opts.onIs?.(col, v); return Promise.resolve(result) },
          then: (res: (v: unknown) => void) => res(result),
        }
        return chain
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.username === undefined ? { username: 'Rex' } : opts.username === null ? null : { username: opts.username } }) }) }),
    }),
  } as never
}

beforeEach(() => {
  vi.mocked(fetchGuardInput).mockResolvedValue(clean)
  vi.mocked(executeDeletion).mockResolvedValue({ ok: true })
  vi.mocked(sendEmail).mockClear()
  vi.mocked(executeDeletion).mockClear()
})

describe('performRequestDeletion', () => {
  const now = new Date('2026-10-07T00:00:00.000Z')

  it('returns every blocker and does not write', async () => {
    vi.mocked(fetchGuardInput).mockResolvedValue({ ...clean, walletBalance: 500, activeListings: 2 })
    const onUpdate = vi.fn()
    const r = await performRequestDeletion(adminWith({ onUpdate }), { id: 'u1', email: 'a@example.com' }, now)
    expect(r).toEqual({ ok: false, reason: 'blocked', blockers: [{ code: 'wallet_balance', amount: 500 }, { code: 'active_listing', count: 2 }] })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('stamps the request, computes the due date 15 days out and emails', async () => {
    const onUpdate = vi.fn()
    const r = await performRequestDeletion(adminWith({ onUpdate }), { id: 'u1', email: 'a@example.com' }, now)
    expect(onUpdate).toHaveBeenCalledWith({ deletion_requested_at: now.toISOString() })
    expect(r).toEqual({ ok: true, requestedAt: now, dueAt: new Date('2026-10-22T00:00:00.000Z') })
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('skips the email when the account has none', async () => {
    await performRequestDeletion(adminWith(), { id: 'u1', email: null }, now)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports save_failed without emailing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performRequestDeletion(adminWith({ updateError: true }), { id: 'u1', email: 'a@example.com' }, now)
    expect(r).toEqual({ ok: false, reason: 'save_failed' })
    expect(sendEmail).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('performCancelDeletion', () => {
  it('clears the request only on a not-yet-deleted profile', async () => {
    const onUpdate = vi.fn()
    const onIs = vi.fn()
    const r = await performCancelDeletion(adminWith({ onUpdate, onIs }), { id: 'u1', email: 'a@example.com' })
    expect(r).toEqual({ ok: true })
    expect(onUpdate).toHaveBeenCalledWith({ deletion_requested_at: null })
    expect(onIs).toHaveBeenCalledWith('deleted_at', null)
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('reports failure without emailing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performCancelDeletion(adminWith({ updateError: true }), { id: 'u1', email: 'a@example.com' })
    expect(r).toEqual({ ok: false })
    expect(sendEmail).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('performDeleteNow', () => {
  it.each(['rex', '  REX  ', 'Rex'])('accepts the username typed as %j', async (typed) => {
    const r = await performDeleteNow(adminWith(), 'u1', typed)
    expect(r).toEqual({ ok: true })
    expect(executeDeletion).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  it.each(['', 'Rexx', 'someone else', 'DELETE'])('rejects %j', async (typed) => {
    const r = await performDeleteNow(adminWith(), 'u1', typed)
    expect(r).toEqual({ ok: false, reason: 'username_mismatch' })
    expect(executeDeletion).not.toHaveBeenCalled()
  })

  it('rejects when the profile has no username', async () => {
    const r = await performDeleteNow(adminWith({ username: null }), 'u1', 'Rex')
    expect(r).toEqual({ ok: false, reason: 'username_mismatch' })
  })

  it('surfaces blockers from executeDeletion', async () => {
    vi.mocked(executeDeletion).mockResolvedValue({ ok: false, blockers: [{ code: 'pending_withdrawal', count: 1 }] })
    const r = await performDeleteNow(adminWith(), 'u1', 'Rex')
    expect(r).toEqual({ ok: false, reason: 'blocked', blockers: [{ code: 'pending_withdrawal', count: 1 }] })
  })
})
