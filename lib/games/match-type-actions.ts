'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { matchTypeSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type MatchTypeActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return matchTypeSchema.safeParse({
    name: formData.get('name') ?? '',
    available: formData.get('available') === 'true',
  })
}

// match_types has no game_id/mode_id — it's the one global section of the
// Game Designer (spec §5.1 item 7), so it lives on the games LIST page, not
// any single game's Designer page.
export async function createMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('match_types').select('*', { count: 'exact', head: true })
  const { error } = await supabase.from('match_types').insert({
    slug,
    name: parsed.data.name,
    available: parsed.data.available,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A match type with this name already exists.' : 'Could not create the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match type.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.from('match_types').update({ name: parsed.data.name, available: parsed.data.available }).eq('id', id)
  if (error) return { error: 'Could not update the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function deleteMatchType(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match type.' }

  const supabase = createClient()
  const { data: refs, error: historyError } = await supabase.from('tournaments').select('id').eq('match_type_id', id).limit(1)
  const hasHistory = Boolean(historyError) || (refs ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('match_types').update({ active: false }).eq('id', id)
    : await supabase.from('match_types').delete().eq('id', id)
  if (error) return { error: 'Could not remove the match type.' }

  revalidatePath('/admin/games')
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderMatchTypes(_prev: MatchTypeActionState, formData: FormData): Promise<MatchTypeActionState> {
  await requireStaff()
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('match_types').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath('/admin/games')
  return { success: true }
}
