import { describe, it, expect, vi } from 'vitest'
import { registerDevice, unregisterDevice } from './devices'

function fakeAdmin(result: { error: { message: string; code?: string } | null } = { error: null }) {
  const calls: Record<string, unknown[]> = { upsert: [], deleteMatch: [] }
  const admin = {
    from: vi.fn(() => ({
      upsert: (row: unknown, opts: unknown) => { calls.upsert.push([row, opts]); return Promise.resolve(result) },
      delete: () => ({
        eq: (col1: string, v1: string) => ({
          eq: (col2: string, v2: string) => { calls.deleteMatch.push([col1, v1, col2, v2]); return Promise.resolve(result) },
        }),
      }),
    })),
  }
  return { admin: admin as never, calls }
}

describe('registerDevice', () => {
  it('upserts by token, reassigning the row to the verified caller', async () => {
    const { admin, calls } = fakeAdmin()
    await registerDevice(admin, 'u1', { token: 't'.repeat(40), platform: 'android', appVersion: '1.0.0' })
    const [row, opts] = calls.upsert[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(row).toMatchObject({ player_id: 'u1', token: 't'.repeat(40), platform: 'android', app_version: '1.0.0' })
    expect(typeof row.last_active).toBe('string')
    expect(opts).toEqual({ onConflict: 'token' })
  })
  it('throws when the upsert fails so the caller sees a 500, not a silent success', async () => {
    const { admin } = fakeAdmin({ error: { message: 'boom', code: '23505' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(registerDevice(admin, 'u1', { token: 't'.repeat(40), platform: 'ios', appVersion: '1' })).rejects.toThrow()
    spy.mockRestore()
  })
})

describe('unregisterDevice', () => {
  it('deletes only this caller’s row for that token', async () => {
    const { admin, calls } = fakeAdmin()
    await unregisterDevice(admin, 'u1', 'tok')
    expect(calls.deleteMatch[0]).toEqual(['token', 'tok', 'player_id', 'u1'])
  })
})
