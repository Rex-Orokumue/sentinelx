import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'crypto'
import {
  buildReference,
  verifyWebhookSignature,
  buildIdentificationPayload,
  buildRecipientPayload,
  buildTransferPayload,
  buildTransferReference,
} from './server'

beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
})

describe('buildReference', () => {
  it('is prefixed and encodes truncated tournament + user ids', () => {
    const ref = buildReference(
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(ref).toMatch(/^sx_11111111_aaaaaaaa_[a-z0-9]{8}$/)
  })

  it('produces distinct references on repeat calls', () => {
    expect(buildReference('t', 'u')).not.toBe(buildReference('t', 'u'))
  })
})

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'charge.success' })
  const sign = (b: string) => createHmac('sha512', 'sk_test_dummy').update(b).digest('hex')

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(body + 'x', sign(body))).toBe(false)
  })

  it('rejects a null signature', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false)
  })
})

describe('buildIdentificationPayload', () => {
  it('maps to the Paystack bank_account identification shape', () => {
    expect(
      buildIdentificationPayload({
        bvn: '12345678901',
        bankCode: '058',
        accountNumber: '0123456789',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).toEqual({
      country: 'NG',
      type: 'bank_account',
      bvn: '12345678901',
      bank_code: '058',
      account_number: '0123456789',
      first_name: 'Ada',
      last_name: 'Lovelace',
    })
  })
})

describe('buildRecipientPayload', () => {
  it('maps to the Paystack transfer recipient shape', () => {
    expect(
      buildRecipientPayload({
        accountName: 'ADA LOVELACE',
        accountNumber: '0123456789',
        bankCode: '058',
      }),
    ).toEqual({
      type: 'nuban',
      name: 'ADA LOVELACE',
      account_number: '0123456789',
      bank_code: '058',
      currency: 'NGN',
    })
  })
})

describe('buildTransferPayload', () => {
  it('maps to the Paystack transfer shape with balance as source', () => {
    expect(
      buildTransferPayload({
        amountKobo: 500000,
        recipientCode: 'RCP_abc',
        reference: 'sxwd_abc_123',
      }),
    ).toEqual({
      source: 'balance',
      amount: 500000,
      recipient: 'RCP_abc',
      reason: 'SentinelX prize withdrawal',
      reference: 'sxwd_abc_123',
    })
  })
})

describe('buildTransferReference', () => {
  it('is prefixed and derived from the withdrawal id', () => {
    const ref = buildTransferReference('11111111-2222-3333-4444-555555555555')
    expect(ref).toMatch(/^sxwd_111111112222_[a-z0-9]{8}$/)
  })

  it('produces distinct references on repeat calls for the same id', () => {
    expect(buildTransferReference('abc')).not.toBe(buildTransferReference('abc'))
  })
})
