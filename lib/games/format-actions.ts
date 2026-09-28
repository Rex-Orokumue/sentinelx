'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { formatSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type FormatActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return formatSchema.safeParse({
    name: formData.get('name') ?? '',
    entryUnit: formData.get('entryUnit') ?? 'solo',
    teamSize: formData.get('teamSize') ?? '1',
    available: formData.get('available') === 'true',
  })
}

export async function createFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const modeId = String(formData.get('modeId') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!modeId || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_mode_formats').select('*', { count: 'exact', head: true }).eq('mode_id', modeId)
  const { error } = await supabase.from('game_mode_formats').insert({
    mode_id: modeId,
    slug,
    name: parsed.data.name,
    entry_unit: parsed.data.entryUnit,
    team_size: parsed.data.teamSize,
    available: parsed.data.available,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A format with this name already exists for this mode.' : 'Could not create the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing format.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_mode_formats')
    .update({
      name: parsed.data.name,
      entry_unit: parsed.data.entryUnit,
      team_size: parsed.data.teamSize,
      available: parsed.data.available,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function deleteFormat(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing format.' }

  const supabase = createClient()
  const { data: refs, error: historyError } = await supabase.from('tournaments').select('id').eq('format_id', id).limit(1)
  const hasHistory = Boolean(historyError) || (refs ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_mode_formats').update({ active: false }).eq('id', id)
    : await supabase.from('game_mode_formats').delete().eq('id', id)
  if (error) return { error: 'Could not remove the format.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderFormats(_prev: FormatActionState, formData: FormData): Promise<FormatActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_mode_formats').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
