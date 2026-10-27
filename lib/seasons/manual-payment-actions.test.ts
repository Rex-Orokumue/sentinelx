import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdmin, createAdminClient, settleReferralForPaidEntry, notify, revalidatePath, rpc } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), createAdminClient: vi.fn(), settleReferralForPaidEntry: vi.fn(),
  notify: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/admin/auth', () => ({ requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry }))
vi.mock('@/lib/notifications/notify', () => ({ notify }))
vi.mock('next/cache', () => ({ revalidatePath }))

import { recordManualPayment } from './manual-payment-actions'

const tournamentId = 'cfca35ab-e072-41bb-942d-dd968e77b5ba'
const playerId = 'e3059d98-a1a9-49fd-abb9-211b4add2bbe'
const actorId = '11111111-1111-4111-8111-111111111111'

function form(reference = 'BANK-123456') {
  const data = new FormData()
  data.set('tournamentId', tournamentId)
  data.set('playerId', playerId)
  data.set('amount', '500')
  data.set('channel', 'bank_transfer')
  data.set('reference', reference)
  data.set('verified', 'yes')
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ userId: actorId })
  createAdminClient.mockReturnValue({ rpc })
  rpc.mockResolvedValue({ data: { status: 'confirmed', newlyPaid: true,
    registrationId: '22222222-2222-4222-8222-222222222222', tournamentTitle: 'DLS Masters Cup', fee: 500 }, error: null })
})

describe('recordManualPayment', () => {
  it('checks admin before service role and records one verified outside payment', async () => {
    expect(await recordManualPayment(undefined, form())).toEqual({ success: true })
    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(createAdminClient.mock.invocationCallOrder[0])
    expect(rpc).toHaveBeenCalledWith('record_manual_invitation_payment', {
      p_tournament: tournamentId, p_player: playerId, p_actor: actorId,
      p_amount: 500, p_channel: 'bank_transfer', p_reference: 'BANK-123456', p_note: null,
    })
    expect(settleReferralForPaidEntry).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'registration_confirmed', playerId }))
  })

  it('requires verification and a real transaction reference', async () => {
    const data = form('x')
    data.delete('verified')
    expect((await recordManualPayment(undefined, data))?.error).toMatch(/verify/i)
    expect(rpc).not.toHaveBeenCalled()
    const short = form('x')
    expect((await recordManualPayment(undefined, short))?.error).toMatch(/reference/i)
  })

  it('does not send another confirmation for an already paid entry', async () => {
    rpc.mockResolvedValue({ data: { status: 'already_paid' }, error: null })
    expect((await recordManualPayment(undefined, form()))?.error).toMatch(/already paid/i)
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports a reused reference without changing a player', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })
    expect((await recordManualPayment(undefined, form()))?.error).toMatch(/reference.*used/i)
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not expose a database failure to the admin', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal database details' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await recordManualPayment(undefined, form()))?.error).toBe('Could not record this payment. Please try again.')
    expect(notify).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
