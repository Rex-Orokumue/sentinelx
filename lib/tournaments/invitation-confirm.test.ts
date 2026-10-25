import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/paystack/server', () => ({ verifyTransaction: vi.fn() }))
import { verifyTransaction } from '@/lib/paystack/server'
import { confirmInvitationAttempt } from './confirm'

beforeEach(() => vi.clearAllMocks())

function admin(status: string) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { status }, error: null }),
  } as never
}

it('does not settle an unverified invitation payment', async () => {
  vi.mocked(verifyTransaction).mockResolvedValue({ status: 'failed', amountKobo: 50000 } as never)
  const db = admin('confirmed')
  expect(await confirmInvitationAttempt(db, 'ref-1')).toBe('not_successful')
  expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
})

it('credits a late successful Paystack charge through the atomic settlement function', async () => {
  vi.mocked(verifyTransaction).mockResolvedValue({ status: 'success', amountKobo: 50000 } as never)
  const db = admin('overpayment_credited')
  expect(await confirmInvitationAttempt(db, 'ref-1')).toBe('overpayment_credited')
  expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('settle_invitation_paystack', {
    p_reference: 'ref-1', p_amount_kobo: 50000,
  })
})
