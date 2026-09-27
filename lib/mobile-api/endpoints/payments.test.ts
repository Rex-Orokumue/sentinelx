import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { confirmRegistration } = vi.hoisted(() => ({ confirmRegistration: vi.fn() }))
vi.mock('@/lib/tournaments/confirm', () => ({ confirmRegistration }))

import { paymentStatusEndpoint } from './payments'

describe('paymentStatusEndpoint', () => {
  it('passes the path param reference straight through to confirmRegistration and returns its status', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    confirmRegistration.mockResolvedValue('confirmed')
    const res = await paymentStatusEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/payments/ref-abc'),
      { params: { reference: 'ref-abc' } },
    )
    expect(confirmRegistration).toHaveBeenCalledWith('ref-abc')
    expect(await res.json()).toEqual({ data: { status: 'confirmed' } })
  })
})
