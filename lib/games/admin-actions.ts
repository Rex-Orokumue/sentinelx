'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { gameSchema } from './schema'
import { slugify } from '@/lib/tournaments/slug'

export type GameFormState = { error?: string; success?: boolean } | undefined

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function createGame(_prev: GameFormState, formData: FormData): Promise<GameFormState> {
  await requireStaff()
  const parsed = gameSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
    iconUrl: formData.get('iconUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const base = slugify(parsed.data.name)
  if (!base) return { error: 'Enter a name that produces a valid slug.' }

  const supabase = createClient()
  let slug = base
  for (let i = 0; i < 5; i++) {
    const { error } = await supabase.from('games').insert({
      name: parsed.data.name,
      slug,
      category: parsed.data.category,
      icon_url: parsed.data.iconUrl || null,
    })
    if (!error) {
      revalidatePath('/admin/games')
      return { success: true }
    }
    if (!isUniqueViolation(error)) return { error: 'Could not create the game. Please try again.' }
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  return { error: 'Could not generate a unique slug. Try a different name.' }
}

export async function toggleGameActive(_prev: GameFormState, formData: FormData): Promise<GameFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const nextActive = formData.get('nextActive') === 'true'
  if (!id) return { error: 'Missing game.' }

  const supabase = createClient()
  const { error } = await supabase.from('games').update({ active: nextActive }).eq('id', id)
  if (error) return { error: 'Could not update the game. Please try again.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}
