'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type StoreActionState = { error?: string; success?: boolean } | undefined

const storeItemSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Slug must be lowercase letters, numbers, underscores only.'),
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.enum(['avatar_border', 'profile_theme', 'username_colour', 'bubble_skin']),
  priceCoins: z.coerce.number().int().positive(),
  previewUrl: z.string().url().optional().or(z.literal('')),
})

export async function createStoreItem(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const parsed = storeItemSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    category: formData.get('category'),
    priceCoins: formData.get('priceCoins'),
    previewUrl: formData.get('previewUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const admin = createAdminClient()
  const { error } = await admin.from('store_items').insert({
    slug: d.slug,
    name: d.name,
    description: d.description ?? null,
    category: d.category,
    price_coins: d.priceCoins,
    preview_url: d.previewUrl || null,
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'That slug is already in use.' }
    return { error: 'Could not create the item.' }
  }
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}

export async function updateStoreItem(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing item.' }
  const priceCoins = Number(formData.get('priceCoins'))
  if (!Number.isInteger(priceCoins) || priceCoins <= 0) return { error: 'Enter a whole price greater than 0.' }

  const admin = createAdminClient()
  await admin.from('store_items').update({ price_coins: priceCoins }).eq('id', id)
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}

export async function toggleStoreItemActive(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!id) return { error: 'Missing item.' }

  const admin = createAdminClient()
  await admin.from('store_items').update({ active: !active }).eq('id', id)
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}
