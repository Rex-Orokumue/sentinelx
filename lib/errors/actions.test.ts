import { describe, it, expect, vi, beforeEach } from 'vitest'

const insert = vi.fn()
const adminFrom = vi.fn(() => ({ insert }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFrom }) }))

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
}))

beforeEach(() => {
  insert.mockClear()
  adminFrom.mockClear()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: null } })
  insert.mockResolvedValue({ data: null, error: null })
})

describe('logClientError', () => {
  it('writes through the service-role client, attaching the viewer id when logged in', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const { logClientError } = await import('./actions')
    await logClientError({ message: 'boom', stack: 'at x', url: '/dashboard', userAgent: 'ua', locale: 'en' })

    expect(adminFrom).toHaveBeenCalledWith('client_error_logs')
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      message: 'boom',
      stack: 'at x',
      digest: null,
      url: '/dashboard',
      user_agent: 'ua',
      locale: 'en',
    })
  })

  it('logs with a null user_id for a logged-out visitor', async () => {
    const { logClientError } = await import('./actions')
    await logClientError({ message: 'boom' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null }))
  })

  it('truncates an oversized message/stack instead of failing the insert', async () => {
    const { logClientError } = await import('./actions')
    await logClientError({ message: 'x'.repeat(5000), stack: 'y'.repeat(9000) })
    const written = insert.mock.calls[0][0]
    expect(written.message).toHaveLength(4000)
    expect(written.stack).toHaveLength(8000)
  })

  it('never throws, even when the insert itself fails', async () => {
    insert.mockRejectedValueOnce(new Error('db unreachable'))
    const { logClientError } = await import('./actions')
    await expect(logClientError({ message: 'boom' })).resolves.toBeUndefined()
  })

  it('never throws when reading the viewer session fails', async () => {
    getUser.mockRejectedValueOnce(new Error('no session'))
    const { logClientError } = await import('./actions')
    await expect(logClientError({ message: 'boom' })).resolves.toBeUndefined()
  })
})
