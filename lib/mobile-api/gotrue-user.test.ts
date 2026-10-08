import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGoTrueUserApi } from './gotrue-user'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
})

function fetchReturning(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('createGoTrueUserApi', () => {
  it('updateEmail PUTs /user with the bearer and apikey headers', async () => {
    const f = fetchReturning(200)
    const r = await createGoTrueUserApi('tok', f).updateEmail('new@example.com')
    expect(r).toEqual({ ok: true })
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/user')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'anon-key' })
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@example.com' })
  })

  it('unlinkIdentity DELETEs the encoded identity id', async () => {
    const f = fetchReturning(204)
    await createGoTrueUserApi('tok', f).unlinkIdentity('a/b')
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/user/identities/a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('signOutOthers POSTs /logout?scope=others', async () => {
    const f = fetchReturning(204)
    await createGoTrueUserApi('tok', f).signOutOthers()
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/logout?scope=others')
    expect(init.method).toBe('POST')
  })

  it('maps a GoTrue error to status, error_code and message', async () => {
    const f = fetchReturning(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' })
    const r = await createGoTrueUserApi('tok', f).updateEmail('x@example.com')
    expect(r).toEqual({ ok: false, error: { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' } })
  })

  it('survives a non-JSON error body', async () => {
    const f = vi.fn(async () => new Response('Bad Gateway', { status: 502 })) as unknown as typeof fetch
    const r = await createGoTrueUserApi('tok', f).signOutOthers()
    expect(r).toMatchObject({ ok: false, error: { status: 502, code: null } })
  })

  it('treats a network failure as a failed result, not a throw', async () => {
    const f = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const r = await createGoTrueUserApi('tok', f).signOutOthers()
    expect(r).toMatchObject({ ok: false, error: { status: 0, message: 'offline' } })
  })
})
