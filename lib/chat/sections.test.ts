/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes for the supabase chain */
import { describe, it, expect, vi } from 'vitest'
import { parseSections, unionSections, getAccountInfo } from './sections'

describe('parseSections', () => {
  it('keeps valid, dedupes, drops unknown, tolerates garbage', () => {
    expect(parseSections({ sections: ['wallet', 'wallet', 'evil', 7, 'kyc'] })).toEqual(['wallet', 'kyc'])
    expect(parseSections(null)).toEqual([])
    expect(parseSections({ sections: 'wallet' })).toEqual([])
    expect(parseSections({ sections: ['wallet'], playerId: 'someone-else' })).toEqual(['wallet'])
  })
  it('caps the list at 8', () => {
    expect(parseSections({ sections: Array(20).fill('wallet') })).toEqual(['wallet'])
  })
})
describe('unionSections', () => {
  it('unions across tool calls and ignores bad JSON', () => {
    expect(unionSections(['{"sections":["wallet"]}', 'nope', '{"sections":["kyc","wallet"]}'])).toEqual(['wallet', 'kyc'])
  })
})

function fakeAdmin(counts: Record<string, number> = {}) {
  const queried: string[] = []
  const chain = (table: string) => {
    queried.push(table)
    const c: any = {
      select: () => c, eq: () => c, in: () => c, or: () => c, order: () => c, limit: () => c,
      maybeSingle: () => Promise.resolve({ data: table === 'wallets' ? { balance: 1500 } : null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: counts[table] ?? 0 }).then(r),
    }
    return c
  }
  return { admin: { from: vi.fn(chain) } as never, queried }
}

describe('getAccountInfo', () => {
  it('queries ONLY the requested sections', async () => {
    const { admin, queried } = fakeAdmin()
    await getAccountInfo(admin, 'u1', ['wallet'])
    expect(queried).toEqual(['wallets', 'sx_coins'])
  })
  it('never includes display names, phone, email or whatsapp keys', async () => {
    const { admin } = fakeAdmin()
    const out = await getAccountInfo(admin, 'u1', ['wallet', 'kyc', 'score', 'notifications', 'withdrawals', 'registrations', 'friendlies', 'matches'])
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/display_name|displayName|phone|whatsapp|email/i)
  })
  it('degrades one failed section to null without failing the others', async () => {
    const admin = {
      from: (t: string) => {
        const c: any = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve(t === 'wallets' ? { data: null, error: { message: 'x' } } : { data: { kyc_status: 'verified' }, error: null }) }
        return c
      },
    } as never
    const out = await getAccountInfo(admin, 'u1', ['wallet', 'kyc'])
    expect(out.wallet).toBeNull()
    expect(out.kyc).toEqual({ status: 'verified' })
  })
  it('uses usernames only for opponent labels, sanitized', async () => {
    const admin = {
      from: (t: string) => {
        const c: any = {
          select: (cols: string) => { if (t === 'friendly_matches') expect(cols).not.toMatch(/display_name/); return c },
          eq: () => c, or: () => c, in: () => c,
          then: (r: (v: unknown) => unknown) =>
            Promise.resolve({ data: t === 'friendly_matches' ? [{ challenger_id: 'u1', opponent_id: 'u2', status: 'pending', stake_amount: null, challenger: { username: 'me' }, opponent: { username: 'rival‮' } }] : [], error: null }).then(r),
        }
        return c
      },
    } as never
    const out = await getAccountInfo(admin, 'u1', ['friendlies'])
    expect(out.friendlies).toEqual([{ opponent: 'rival', status: 'pending', stakeNaira: null }])
  })
})
