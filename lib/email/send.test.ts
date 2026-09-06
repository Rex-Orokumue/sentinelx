import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './send'

const input = { to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' }

describe('sendEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'SentinelX <noreply@sentinelxesports.com.ng>')
  })
  afterEach(() => vi.unstubAllEnvs())

  // Same no-op-when-unconfigured contract as TERMII_API_KEY, so local dev and
  // CI never attempt a real send.
  it('no-ops when the API key is absent', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await sendEmail(input)).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('no-ops when the from address is absent', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await sendEmail(input)).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts to the Resend API and reports success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    expect(await sendEmail(input)).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.to).toEqual(['a@b.com'])
    expect(body.subject).toBe('Hi')
    expect(body.from).toBe('SentinelX <noreply@sentinelxesports.com.ng>')
  })

  it('reports failure on a non-2xx response without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }))
    expect(await sendEmail(input)).toBe(false)
  })

  // A deletion must never fail because its notification email did.
  it('swallows a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await sendEmail(input)).toBe(false)
  })
})
