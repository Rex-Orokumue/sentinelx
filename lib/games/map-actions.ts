'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { mapSchema } from './mode-catalogue-schema'

export type MapActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return mapSchema.safeParse({ name: formData.get('name') ?? '' })
}

export async function createMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const modeId = String(formData.get('modeId') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!modeId || !gameId) return { error: 'Missing mode.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { count } = await supabase.from('game_mode_maps').select('*', { count: 'exact', head: true }).eq('mode_id', modeId)
  const { error } = await supabase.from('game_mode_maps').insert({
    mode_id: modeId,
    name: parsed.data.name,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A map with this name already exists for this mode.' : 'Could not create the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function updateMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing map.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.from('game_mode_maps').update({ name: parsed.data.name }).eq('id', id)
  if (error) return { error: error.code === '23505' ? 'A map with this name already exists for this mode.' : 'Could not update the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

// Maps are referenced from two places: tournaments.default_map_id (the
// tournament's default) and tournament_lobbies.map_id (a per-lobby
// override) — every other row in this catalogue only ever has one
// reference point, so this check has one extra leg.
export async function deleteMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing map.' }

  const supabase = createClient()
  const [tournamentRefs, lobbyRefs] = await Promise.all([
    supabase.from('tournaments').select('id').eq('default_map_id', id).limit(1),
    supabase.from('tournament_lobbies').select('id').eq('map_id', id).limit(1),
  ])
  const hasHistory =
    Boolean(tournamentRefs.error) || Boolean(lobbyRefs.error) || (tournamentRefs.data ?? []).length > 0 || (lobbyRefs.data ?? []).length > 0

  const { error } = hasHistory
    ? await supabase.from('game_mode_maps').update({ active: false }).eq('id', id)
    : await supabase.from('game_mode_maps').delete().eq('id', id)
  if (error) return { error: 'Could not remove the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reactivateMap(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing map.' }

  const supabase = createClient()
  const { error } = await supabase.from('game_mode_maps').update({ active: true }).eq('id', id)
  if (error) return { error: 'Could not reactivate the map.' }

  revalidatePath(`/admin/games/${gameId}`)
  revalidatePath('/admin/tournaments/new')
  return { success: true }
}

export async function reorderMaps(_prev: MapActionState, formData: FormData): Promise<MapActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_mode_maps').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
