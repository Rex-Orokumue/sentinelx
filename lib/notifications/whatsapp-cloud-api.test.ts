import { describe, it, expect, afterEach } from 'vitest'
import { sendWhatsAppOtp } from './whatsapp-cloud-api'

const originalToken = process.env.META_WHATSAPP_TOKEN
const originalPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
afterEach(() => {
  if (originalToken === undefined) delete process.env.META_WHATSAPP_TOKEN
  else process.env.META_WHATSAPP_TOKEN = originalToken
  if (originalPhoneId === undefined) delete process.env.META_WHATSAPP_PHONE_NUMBER_ID
  else process.env.META_WHATSAPP_PHONE_NUMBER_ID = originalPhoneId
})

describe('sendWhatsAppOtp', () => {
  it('no-ops (skipped) when Meta credentials are not configured', async () => {
    delete process.env.META_WHATSAPP_TOKEN
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID
    const r = await sendWhatsAppOtp({ to: '2348000000000', code: '123456' })
    expect(r).toEqual({ ok: false, skipped: true })
  })
})
