import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadStore } from '@/lib/store/catalogue'
import { purchaseItem } from '@/lib/store/purchase-service'
import { setItemEquipped } from '@/lib/store/equip-service'

// The catalogue is public data; ownership, equipped flags and the balance are returned only for the caller.
// Every write is owner-scoped: the player id is always ctx.userId, never a body, path or query value.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const itemParam = [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] as const

// A malformed id is "not found", answered before any service or database call.
function itemId(params: Record<string, string>): string {
  const id = params.itemId
  if (!id || !UUID.test(id)) throw Errors.notFound()
  return id
}

const storeItem = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  priceCoins: z.number().int(),
  previewUrl: z.string(),
  owned: z.boolean(),
  equipped: z.boolean(),
})

export const getStoreEndpoint = defineEndpoint({
  operationId: 'getStore',
  method: 'GET',
  path: '/store',
  summary: 'The coin store catalogue. Public; the coin balance and each item\'s owned/equipped flags are returned only when signed in.',
  auth: 'public',
  response: z.object({ balance: z.number().int().nullable(), items: z.array(storeItem) }),
  handler: async ({ ctx }) => {
    const result = await loadStore(createAdminClient(), { playerId: ctx?.userId ?? null })
    if (!result.ok) throw new ApiError(500, 'store_load_failed', 'Could not load the store.')
    return { balance: result.balance, items: result.items }
  },
})

export const purchaseStoreItemEndpoint = defineEndpoint({
  operationId: 'purchaseStoreItem',
  method: 'POST',
  path: '/store/{itemId}/purchase',
  summary: 'Buy one store item with SX Coins. Atomic: the coin debit and the ownership are one transaction. SX Coins can only be earned, never bought.',
  auth: 'user',
  idempotent: true,
  parameters: [...itemParam],
  response: z.object({ balance: z.number().int(), itemId: z.string() }),
  handler: async ({ ctx, params }) => {
    const id = itemId(params)
    const result = await purchaseItem(ctx.admin, { playerId: ctx.userId, itemId: id })
    if (result.ok) return { balance: result.balance, itemId: id }
    switch (result.reason) {
      case 'not_found':
        throw Errors.notFound()
      case 'inactive':
        throw new ApiError(409, 'item_unavailable', 'This item is no longer available.')
      case 'owned':
        throw new ApiError(409, 'already_owned', 'You already own this item.')
      case 'insufficient':
        throw new ApiError(422, 'insufficient_coins', 'Not enough SX Coins.')
      case 'pending_deletion':
        throw new ApiError(403, 'account_pending_deletion', 'Cancel your account deletion in Settings to do this.')
      default:
        throw new ApiError(503, 'store_unavailable', 'The store is unavailable right now. Please try again.')
    }
  },
})

function equipEndpoint(args: { operationId: string; path: string; summary: string; equipped: boolean }) {
  return defineEndpoint({
    operationId: args.operationId,
    method: 'POST',
    path: args.path,
    summary: args.summary,
    auth: 'user',
    parameters: [...itemParam],
    response: z.object({ itemId: z.string(), category: z.string() }),
    handler: async ({ ctx, params }) => {
      const id = itemId(params)
      const result = await setItemEquipped(ctx.admin, { playerId: ctx.userId, itemId: id, equipped: args.equipped })
      if (result.ok) return { itemId: id, category: result.category }
      if (result.reason === 'not_found') throw Errors.notFound()
      if (result.reason === 'not_owned') throw new ApiError(409, 'not_owned', 'You do not own this item.')
      throw new ApiError(503, 'store_unavailable', 'The store is unavailable right now. Please try again.')
    },
  })
}

export const equipStoreItemEndpoint = equipEndpoint({
  operationId: 'equipStoreItem',
  path: '/store/{itemId}/equip',
  summary: 'Equip an owned item. One item per category is equipped, so this swaps the category in one step. Safe to repeat.',
  equipped: true,
})

export const unequipStoreItemEndpoint = equipEndpoint({
  operationId: 'unequipStoreItem',
  path: '/store/{itemId}/unequip',
  summary: 'Unequip an owned item. Safe to repeat.',
  equipped: false,
})
