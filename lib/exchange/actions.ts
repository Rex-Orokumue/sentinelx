'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { listingSchema } from './schema'
import { validateImageCount } from './images'

export type ActionState = { error?: string; success?: boolean } | undefined

// Called from the client form with already-uploaded image URLs (ordered).
export async function createListing(input: {
  title: string
  category: string
  price: number
  gameId?: string
  description?: string
  imageUrls: string[]
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to create a listing.' }

  const parsed = listingSchema.safeParse({
    title: input.title,
    category: input.category,
    price: input.price,
    gameId: input.gameId ?? '',
    description: input.description ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const urls = input.imageUrls.slice(0, 8) // sane cap
  if (!validateImageCount(d.category, urls.length)) {
    return { error: 'This category requires at least one image.' }
  }

  const { data: listing, error } = await supabase
    .from('marketplace_listings')
    .insert({
      seller_id: user.id,
      category: d.category,
      title: d.title,
      price: d.price,
      game_id: d.gameId || null,
      description: d.description || null,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !listing) return { error: 'Could not create the listing. Please try again.' }

  if (urls.length > 0) {
    const rows = urls.map((url, i) => ({ listing_id: listing.id, image_url: url, display_order: i }))
    await supabase.from('listing_images').insert(rows)
  }

  revalidatePath('/exchange')
  revalidatePath('/dashboard')
  return { id: listing.id }
}

export async function removeListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  // RLS + the status trigger permit a seller to set their own listing to 'removed'.
  const { error } = await supabase.from('marketplace_listings').update({ status: 'removed' }).eq('id', id)
  if (error) return { error: 'Could not remove the listing.' }
  revalidatePath('/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}
