'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { purchaseItem } from '@/lib/store/purchase-service'
import { setItemEquipped } from '@/lib/store/equip-service'
import { RESTRICTION_MESSAGE } from '@/lib/settings/restriction'

export type PurchaseState = { error?: string; success?: boolean } | undefined

const PURCHASE_ERRORS = {
  not_found: 'Item not found.',
  inactive: 'This item is no longer available.',
  owned: 'You already own this item.',
  insufficient: 'Not enough SX Coins.',
  unavailable: 'Could not complete the purchase. Please try again.',
  pending_deletion: RESTRICTION_MESSAGE,
} as const

const EQUIP_ERRORS = {
  not_found: 'Item not found.',
  not_owned: 'You do not own this item.',
  unavailable: 'Could not equip this item. Please try again.',
} as const

export async function purchaseStoreItem(_prev: PurchaseState, formData: FormData): Promise<PurchaseState> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return { error: 'Missing item.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  // One atomic purchase (debit + ownership in a single transaction); see lib/store/purchase-service.ts.
  const result = await purchaseItem(createAdminClient(), { playerId: user.id, itemId })
  if (!result.ok) return { error: PURCHASE_ERRORS[result.reason] }

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

  const result = await setItemEquipped(createAdminClient(), { playerId: user.id, itemId, equipped: true })
  if (!result.ok) return { error: EQUIP_ERRORS[result.reason] }

  revalidatePath('/store')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/dashboard')
  return { success: true }
}
