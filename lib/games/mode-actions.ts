'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { modeSchema } from './mode-catalogue-schema'
import { slugify } from '@/lib/tournaments/slug'

export type ModeActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return modeSchema.safeParse({
    name: formData.get('name') ?? '',
    competitionFormat: formData.get('competitionFormat') ?? 'head_to_head',
  })
}

export async function createMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  if (!gameId) return { error: 'Missing game.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const slug = slugify(parsed.data.name).replace(/-/g, '_')
  if (!slug) return { error: 'Enter a name that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_modes').select('*', { count: 'exact', head: true }).eq('game_id', gameId)
  const { error } = await supabase.from('game_modes').insert({
    game_id: gameId,
    slug,
    name: parsed.data.name,
    competition_format: parsed.data.competitionFormat,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A mode with this name already exists for this game.' : 'Could not create the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_modes')
    .update({ name: parsed.data.name, competition_format: parsed.data.competitionFormat })
    .eq('id', id)
  if (error) return { error: 'Could not update the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

// Deleting a Mode cascades (ON DELETE CASCADE) to its own formats/maps/match
// rules. If the mode itself, or any of those children, is referenced by a
// tournament (or, for a map, a tournament_lobbies row), hard-deleting the
// mode would silently destroy catalogue data a past tournament still points
// to — so this checks every descendant, not just the mode row itself.
export async function deleteMode(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing mode.' }

  const supabase = createClient()
  const [directRef, formatRows, mapRows, ruleRows] = await Promise.all([
    supabase.from('tournaments').select('id').eq('mode_id', id).limit(1),
    supabase.from('game_mode_formats').select('id').eq('mode_id', id),
    supabase.from('game_mode_maps').select('id').eq('mode_id', id),
    supabase.from('game_mode_match_rules').select('id').eq('mode_id', id),
  ])

  const formatIds = (formatRows.data ?? []).map((r: { id: string }) => r.id)
  const mapIds = (mapRows.data ?? []).map((r: { id: string }) => r.id)
  const ruleIds = (ruleRows.data ?? []).map((r: { id: string }) => r.id)

  const [formatRef, mapRef, lobbyRef, ruleRef] = await Promise.all([
    formatIds.length ? supabase.from('tournaments').select('id').in('format_id', formatIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    mapIds.length ? supabase.from('tournaments').select('id').in('default_map_id', mapIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    mapIds.length ? supabase.from('tournament_lobbies').select('id').in('map_id', mapIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ruleIds.length ? supabase.from('tournaments').select('id').in('match_rule_id', ruleIds).limit(1) : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ])

  // A failed check must not fail open into a hard delete (which would
  // cascade-destroy the mode's formats/maps/rules) — deactivating a mode
  // nobody used costs nothing, while wrongly cascading one still in use loses
  // catalogue data every tournament page that references it needs.
  const anyError = directRef.error || formatRows.error || mapRows.error || ruleRows.error || formatRef.error || mapRef.error || lobbyRef.error || ruleRef.error
  const hasHistory =
    Boolean(anyError) ||
    (directRef.data ?? []).length > 0 ||
    (formatRef.data ?? []).length > 0 ||
    (mapRef.data ?? []).length > 0 ||
    (lobbyRef.data ?? []).length > 0 ||
    (ruleRef.data ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_modes').update({ active: false }).eq('id', id)
    : await supabase.from('game_modes').delete().eq('id', id)
  if (error) return { error: 'Could not remove the mode.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderModes(_prev: ModeActionState, formData: FormData): Promise<ModeActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_modes').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
