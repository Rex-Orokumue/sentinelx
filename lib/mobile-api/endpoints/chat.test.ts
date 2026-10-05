import { describe, it, expect, vi, beforeEach } from 'vitest'

const admit = vi.fn()
const run = vi.fn()
vi.mock('@/lib/chat/admission', () => ({ admitChatTurn: (...a: unknown[]) => admit(...a) }))
vi.mock('@/lib/chat/service', () => ({ runChatTurn: (...a: unknown[]) => run(...a) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('groq-sdk', () => ({ default: class {} }))
const getUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }) })),
}))
import { postChatMessageEndpoint } from './chat'

const turn = '11111111-1111-4111-8111-111111111111'
const call = (headers: Record<string, string> = {}, body: unknown = { messages: [{ role: 'user', content: 'hi' }], clientTurnId: turn, locale: 'fr' }) =>
  postChatMessageEndpoint.handler(new Request('https://x.test/api/mobile/v1/chat/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
beforeEach(() => {
  admit.mockReset(); run.mockReset(); getUser.mockReset()
  vi.stubEnv('GROQ_API_KEY', 'k')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  run.mockReturnValue((async function* () { yield { t: 'done', persisted: false } })())
})

describe('POST /chat/messages', () => {
  it('rate-limited admission is 429 with code, fields and Retry-After before any stream', async () => {
    admit.mockResolvedValue({ ok: false, code: 'chat_rate_limited', retryAfterSeconds: 42 })
    const res = await call()
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(await res.json()).toMatchObject({ error: { code: 'chat_rate_limited', fields: { retryAfterSeconds: '42' } } })
    expect(run).not.toHaveBeenCalled()
  })
  it('an exhausted budget is 503 chat_unavailable', async () => {
    admit.mockResolvedValue({ ok: false, code: 'chat_unavailable' })
    const res = await call()
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('chat_unavailable')
  })
  it('a missing provider key is 503 chat_unavailable', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    admit.mockResolvedValue({ ok: true })
    const res = await call()
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('chat_unavailable')
  })
  it('signed-out: userId null, ip from the first x-forwarded-for hop, device id passed only when well-formed', async () => {
    admit.mockResolvedValue({ ok: true })
    await (await call({ 'x-forwarded-for': '41.58.1.2, 10.0.0.1', 'x-device-id': 'device-abc-12345' })).text()
    expect(admit.mock.calls[0][1]).toEqual({ userId: null, ip: '41.58.1.2', deviceId: 'device-abc-12345' })
    await (await call({ 'x-device-id': 'bad id!' })).text()
    expect(admit.mock.calls[1][1].deviceId).toBeNull()
  })
  it('a device id cannot be used to claim a signed-in identity: only the bearer decides userId', async () => {
    admit.mockResolvedValue({ ok: true })
    await (await call({ 'x-device-id': 'device-abc-12345' })).text()
    expect(admit.mock.calls[0][1].userId).toBeNull()
  })
  it('a valid bearer makes the turn signed-in with the verified user id', async () => {
    admit.mockResolvedValue({ ok: true })
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: null } }, error: null })
    await (await call({ authorization: 'Bearer good' })).text()
    expect(admit.mock.calls[0][1].userId).toBe('u1')
    expect(run.mock.calls[0][1].userId).toBe('u1')
  })
  it('passes locale, clientTurnId and the abort signal through to the turn', async () => {
    admit.mockResolvedValue({ ok: true })
    await (await call()).text()
    expect(run.mock.calls[0][1]).toMatchObject({ locale: 'fr', clientTurnId: turn, userId: null })
    expect(run.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })
  it('streams the turn events as NDJSON', async () => {
    admit.mockResolvedValue({ ok: true })
    const res = await call()
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    expect(JSON.parse((await res.text()).trim())).toEqual({ t: 'done', persisted: false })
  })
  it('a garbage bearer is 401 and never reaches admission', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const res = await call({ authorization: 'Bearer nope' })
    expect(res.status).toBe(401)
    expect(admit).not.toHaveBeenCalled()
  })
  it('an invalid body (last message is the assistant) is validation_failed before admission', async () => {
    const res = await call({}, { messages: [{ role: 'assistant', content: 'x' }], clientTurnId: turn })
    expect(res.status).toBe(400)
    expect(admit).not.toHaveBeenCalled()
  })
})
