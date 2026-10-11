import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

// Runs ONLY against the staging Supabase project (guarded by URL). It creates one throwaway zzqa user
// and deletes it afterwards. It must never run against production.
const onStaging = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ofxmoxpvwbemfouaowoa')

describe.skipIf(!onStaging)('coin_apply / store_purchase / store_equip (staging only)', () => {
  let admin: ReturnType<typeof createAdminClient>
  let playerId = ''
  let bronzeId = ''
  let purpleId = ''
  let goldNameId = ''
  const stamp = Date.now()

  const balance = async () => (await admin.from('sx_coins').select('balance').eq('player_id', playerId).single()).data!.balance
  const ledgerCount = async () =>
    (await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)).count
  const grant = (n: number) =>
    admin.rpc('coin_apply', { p_player: playerId, p_delta: n, p_source: 'admin_grant', p_reference: null, p_description: 'seed', p_clamp: true })

  beforeAll(async () => {
    admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email: `zzqa+coin${stamp}@example.com`,
      email_confirm: true,
      user_metadata: { username: `zzqa_c${stamp % 1_000_000}` },
    })
    if (error || !data.user) throw error ?? new Error('could not create the staging test user')
    playerId = data.user.id
    const ids = await admin.from('store_items').select('id, slug').in('slug', ['avatar_border_bronze', 'avatar_border_purple_glow', 'username_gold'])
    for (const r of ids.data ?? []) {
      if (r.slug === 'avatar_border_bronze') bronzeId = r.id
      if (r.slug === 'avatar_border_purple_glow') purpleId = r.id
      if (r.slug === 'username_gold') goldNameId = r.id
    }
    const seed = await grant(1000)
    if (seed.error) throw seed.error
  })

  afterAll(async () => {
    if (admin && playerId) await admin.auth.admin.deleteUser(playerId)
  })

  it('20 parallel mixed credits and strict debits never lose an update', async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      admin.rpc('coin_apply', {
        p_player: playerId,
        p_delta: i % 2 === 0 ? 50 : -30,
        p_source: i % 2 === 0 ? 'admin_grant' : 'friendly_stake',
        p_reference: null,
        p_description: null,
        p_clamp: i % 2 === 0,
      }),
    )
    const results = await Promise.all(calls)
    expect(results.every((r) => !r.error)).toBe(true)
    const { data } = await admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', playerId).single()
    expect(data!.balance).toBe(1000 + 10 * 50 - 10 * 30)
    expect(data!.total_earned - data!.total_spent).toBe(data!.balance)
  })

  it('strict mode refuses an overdraft and writes nothing; clamp mode floors at zero', async () => {
    const before = await balance()
    const rows = await ledgerCount()
    const strict = await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(before + 1), p_source: 'friendly_stake', p_reference: null, p_description: null, p_clamp: false })
    expect(strict.error).toBeNull()
    expect(strict.data).toBeNull()
    expect(await balance()).toBe(before)
    expect(await ledgerCount()).toBe(rows)
    const clamped = await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(before + 500), p_source: 'admin_deduct', p_reference: null, p_description: null, p_clamp: true })
    expect(clamped.data).toBe(0)
    const last = (await admin.from('sx_coin_transactions').select('amount, balance_after').eq('player_id', playerId).order('created_at', { ascending: false }).limit(1).single()).data!
    expect(last).toEqual({ amount: -before, balance_after: 0 })
    await grant(1000)
  })

  it('20 parallel purchases of one item: exactly one ok, nineteen owned, one debit', async () => {
    const before = await balance()
    const results = await Promise.all(Array.from({ length: 20 }, () => admin.rpc('store_purchase', { p_player: playerId, p_item: bronzeId })))
    const statuses = results.map((r) => (r.data as { status: string }).status)
    expect(statuses.filter((s) => s === 'ok')).toHaveLength(1)
    expect(statuses.filter((s) => s === 'owned')).toHaveLength(19)
    expect(await balance()).toBe(before - 150)
    const { count } = await admin.from('player_store_items').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('item_id', bronzeId)
    expect(count).toBe(1)
    const { count: debits } = await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('source', 'store_purchase').eq('reference_id', bronzeId)
    expect(debits).toBe(1)
  })

  it('a purchase with too little balance writes nothing', async () => {
    const bal = await balance()
    await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(bal - 100), p_source: 'friendly_stake', p_reference: null, p_description: null, p_clamp: false }) // leave 100 (< 300)
    const ledgerBefore = await ledgerCount()
    const res = await admin.rpc('store_purchase', { p_player: playerId, p_item: purpleId })
    expect(res.data).toEqual({ status: 'insufficient', balance: 100 })
    const { count: owned } = await admin.from('player_store_items').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('item_id', purpleId)
    expect(owned).toBe(0)
    expect(await ledgerCount()).toBe(ledgerBefore)
    await grant(5000)
  })

  it('equip swaps the category in one step; unequip clears the profile column through the trigger', async () => {
    expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: purpleId })).data).toMatchObject({ status: 'ok' })
    expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: goldNameId })).data).toMatchObject({ status: 'ok' })
    const border = async () => (await admin.from('profiles').select('equipped_avatar_border').eq('id', playerId).single()).data!.equipped_avatar_border
    const equippedIds = async () => ((await admin.from('player_store_items').select('item_id').eq('player_id', playerId).eq('equipped', true)).data ?? []).map((r) => r.item_id).sort()

    expect((await admin.rpc('store_equip', { p_player: playerId, p_item: bronzeId, p_equipped: true })).data).toEqual({ status: 'ok', category: 'avatar_border' })
    expect(await border()).toBe('avatar_border_bronze')
    await admin.rpc('store_equip', { p_player: playerId, p_item: purpleId, p_equipped: true })
    expect(await border()).toBe('avatar_border_purple_glow')
    expect(await equippedIds()).toEqual([purpleId]) // bronze was swapped off in the same step
    await admin.rpc('store_equip', { p_player: playerId, p_item: goldNameId, p_equipped: true })
    expect(await border()).toBe('avatar_border_purple_glow') // another category leaves the border alone
    expect(await equippedIds()).toEqual([purpleId, goldNameId].sort())
    expect((await admin.rpc('store_equip', { p_player: playerId, p_item: purpleId, p_equipped: false })).data).toEqual({ status: 'ok', category: 'avatar_border' })
    expect(await border()).toBeNull()
    expect(await equippedIds()).toEqual([goldNameId])
  })

  it('not_found and not_owned', async () => {
    const ghost = '00000000-0000-4000-8000-000000000999'
    expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: ghost })).data).toEqual({ status: 'not_found' })
    expect((await admin.rpc('store_equip', { p_player: playerId, p_item: ghost, p_equipped: true })).data).toEqual({ status: 'not_found' })
    const { data: other } = await admin.from('store_items').select('id').eq('slug', 'avatar_border_gold_crown').single()
    expect((await admin.rpc('store_equip', { p_player: playerId, p_item: other!.id, p_equipped: true })).data).toEqual({ status: 'not_owned' })
  })
})
