import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'crypto'
import { buildReference, verifyWebhookSignature } from './server'

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
