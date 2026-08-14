'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance } from './service'
import { decidePurchase } from './decide'

export type PurchaseState = { error?: string; success?: boolean } | undefined

export async function purchaseStoreItem(_prev: PurchaseState, formData: FormData): Promise<PurchaseState> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return { error: 'Missing item.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('store_items')
    .select('id, name, active, price_coins')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return { error: 'Item not found.' }

  const { data: existingOwned } = await admin
    .from('player_store_items')
    .select('id')
    .eq('player_id', user.id)
    .eq('item_id', itemId)
    .maybeSingle()

  const balance = await getCoinBalance(admin, user.id)
  const decision = decidePurchase({ item, alreadyOwned: !!existingOwned, balance })
  if (!decision.ok) return { error: decision.error }

  const { data: coinsRow } = await admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', user.id).maybeSingle()
  const newBalance = balance - item.price_coins
  await admin.from('sx_coins').upsert({
    player_id: user.id,
    balance: newBalance,
    total_earned: coinsRow?.total_earned ?? 0,
    total_spent: (coinsRow?.total_spent ?? 0) + item.price_coins,
    updated_at: new Date().toISOString(),
  })
  await admin.from('sx_coin_transactions').insert({
    player_id: user.id,
    amount: -item.price_coins,
    balance_after: newBalance,
    source: 'store_purchase',
    reference_id: itemId,
    description: item.name,
  })
  const { error: insertErr } = await admin.from('player_store_items').insert({ player_id: user.id, item_id: itemId })
  if (insertErr) {
    // UNIQUE(player_id, item_id) race — refund the coins we just deducted.
    await admin.from('sx_coins').update({ balance, total_spent: coinsRow?.total_spent ?? 0 }).eq('player_id', user.id)
    return { error: 'You already own this item.' }
  }

  revalidatePath('/store')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function equipStoreItem(_prev: PurchaseState, formData: FormData): Promise<PurchaseState> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return { error: 'Missing item.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: owned } = await admin
    .from('player_store_items')
    .select('id, item_id, store_items(category)')
    .eq('player_id', user.id)
    .eq('item_id', itemId)
    .maybeSingle()
  if (!owned) return { error: 'You do not own this item.' }

  const categoryRef = owned.store_items as { category: string } | { category: string }[] | null
  const category = Array.isArray(categoryRef) ? categoryRef[0]?.category : categoryRef?.category
  if (!category) return { error: 'Could not resolve item category.' }

  const { data: sameCategoryItems } = await admin.from('store_items').select('id').eq('category', category)
  const sameCategoryIds = (sameCategoryItems ?? []).map((i) => i.id)
  await admin
    .from('player_store_items')
    .update({ equipped: false })
    .eq('player_id', user.id)
    .in('item_id', sameCategoryIds)
  await admin.from('player_store_items').update({ equipped: true }).eq('player_id', user.id).eq('item_id', itemId)

  revalidatePath('/store')
  revalidatePath('/players/[username]', 'page')
  return { success: true }
}
