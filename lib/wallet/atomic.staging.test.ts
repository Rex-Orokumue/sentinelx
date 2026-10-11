import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

// Runs ONLY against the staging Supabase project (guarded by URL). It creates one throwaway
// zzqa_ user and deletes it afterwards. It must never run against production.
const onStaging = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ofxmoxpvwbemfouaowoa')

describe.skipIf(!onStaging)('wallet_apply atomicity (staging only)', () => {
  let admin: ReturnType<typeof createAdminClient>
  let playerId = ''
  const stamp = Date.now()

  beforeAll(async () => {
    admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email: `zzqa+wallet${stamp}@example.com`,
      email_confirm: true,
      user_metadata: { username: `zzqa_w${stamp % 1_000_000}` },
    })
    if (error || !data.user) throw error ?? new Error('could not create the staging test user')
    playerId = data.user.id
    const seed = await admin.rpc('wallet_apply', {
      p_player: playerId, p_delta: 1000, p_type: 'admin_credit', p_reference: null, p_note: 'seed', p_category: 'bonus',
    })
    if (seed.error) throw seed.error
  })

  afterAll(async () => {
    if (admin && playerId) await admin.auth.admin.deleteUser(playerId)
  })

  it('20 parallel credits and debits never lose an update', async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      admin.rpc('wallet_apply', {
        p_player: playerId,
        p_delta: i % 2 === 0 ? 50 : -30,
        p_type: i % 2 === 0 ? 'admin_credit' : 'withdrawal_request',
        p_reference: null,
        p_note: null,
        p_category: i % 2 === 0 ? 'bonus' : 'withdrawal',
      }),
    )
    const results = await Promise.all(calls)
    expect(results.every((r) => !r.error)).toBe(true)
    const { data } = await admin.from('wallets').select('balance').eq('player_id', playerId).single()
    expect(data!.balance).toBe(1000 + 10 * 50 - 10 * 30)
    const { count } = await admin.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)
    expect(count).toBe(21)
  })

  it('a debit above the balance returns null and writes nothing', async () => {
    const before = (await admin.from('wallets').select('balance').eq('player_id', playerId).single()).data!.balance
    const { data, error } = await admin.rpc('wallet_apply', {
      p_player: playerId, p_delta: -(before + 1), p_type: 'withdrawal_request', p_reference: null, p_note: null, p_category: 'withdrawal',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect((await admin.from('wallets').select('balance').eq('player_id', playerId).single()).data!.balance).toBe(before)
  })

  it('withdrawal: a second pending is refused, insufficient leaves no row', async () => {
    const args = { p_player: playerId, p_amount: 100, p_bank_name: 'Test Bank', p_account_number: '0000000000', p_account_name: 'ZZQA', p_category: 'withdrawal' }
    const first = await admin.rpc('wallet_request_withdrawal', args)
    expect(first.data).toMatchObject({ status: 'ok' })
    const second = await admin.rpc('wallet_request_withdrawal', args)
    expect(second.data).toEqual({ status: 'pending_exists' })
    await admin.from('withdrawal_requests').update({ status: 'rejected' }).eq('player_id', playerId)
    const big = await admin.rpc('wallet_request_withdrawal', { ...args, p_amount: 99_999_999 })
    expect(big.data).toEqual({ status: 'insufficient' })
    const { count } = await admin.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('status', 'pending')
    expect(count).toBe(0)
  })
})
