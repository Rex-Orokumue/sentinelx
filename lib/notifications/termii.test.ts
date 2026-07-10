import { describe, it, expect, afterEach } from 'vitest'
import { sendWhatsApp } from './termii'

const original = process.env.TERMII_API_KEY
afterEach(() => {
  if (original === undefined) delete process.env.TERMII_API_KEY
  else process.env.TERMII_API_KEY = original
})

describe('sendWhatsApp', () => {
  it('no-ops (skipped) when no API key is configured', async () => {
    delete process.env.TERMII_API_KEY
    const r = await sendWhatsApp({ to: '+2348000000000', templateName: 'x', body: 'hi' })
    expect(r).toEqual({ ok: false, skipped: true })
  })
})
