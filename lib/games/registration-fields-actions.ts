'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { registrationFieldSchema } from './registration-fields-schema'
import { slugify } from '@/lib/tournaments/slug'

export type RegistrationFieldActionState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return registrationFieldSchema.safeParse({
    label: formData.get('label') ?? '',
    placeholder: formData.get('placeholder') ?? '',
    inputType: formData.get('inputType') ?? 'text',
    required: formData.get('required') === 'true',
    validationPattern: formData.get('validationPattern') ?? '',
    validationMessage: formData.get('validationMessage') ?? '',
    showOnBracket: formData.get('showOnBracket') === 'true',
  })
}

export async function createRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  if (!gameId) return { error: 'Missing game.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const fieldKey = slugify(parsed.data.label).replace(/-/g, '_')
  if (!fieldKey) return { error: 'Enter a label that produces a valid key.' }

  const supabase = createClient()
  const { count } = await supabase.from('game_registration_fields').select('*', { count: 'exact', head: true }).eq('game_id', gameId)
  const { error } = await supabase.from('game_registration_fields').insert({
    game_id: gameId,
    field_key: fieldKey,
    label: parsed.data.label,
    placeholder: parsed.data.placeholder || null,
    input_type: parsed.data.inputType,
    required: parsed.data.required,
    validation_pattern: parsed.data.validationPattern || null,
    validation_message: parsed.data.validationMessage || null,
    show_on_bracket: parsed.data.showOnBracket,
    seq: (count ?? 0) + 1,
  })
  if (error) return { error: error.code === '23505' ? 'A field with this key already exists for this game.' : 'Could not create the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

export async function updateRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing field.' }

  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase
    .from('game_registration_fields')
    .update({
      label: parsed.data.label,
      placeholder: parsed.data.placeholder || null,
      input_type: parsed.data.inputType,
      required: parsed.data.required,
      validation_pattern: parsed.data.validationPattern || null,
      validation_message: parsed.data.validationMessage || null,
      show_on_bracket: parsed.data.showOnBracket,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

// Hard-deletes only if nothing has used this field yet; otherwise deactivates
// so past registrations that carry this key in their registration_details
// jsonb still resolve to a label everywhere it's displayed.
export async function deleteRegistrationField(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const gameId = String(formData.get('gameId') ?? '')
  if (!id || !gameId) return { error: 'Missing field.' }

  const supabase = createClient()
  const { data: field } = await supabase.from('game_registration_fields').select('field_key').eq('id', id).maybeSingle()
  if (!field) return { error: 'Field not found.' }

  // Postgrest's jsonb-contains filter needs a full value to match against, not
  // a bare key check, so this reads a page of the game's registration_details
  // and checks for the key in application code instead — simpler and correct
  // at this table's scale.
  const { data: regs, error: historyError } = await supabase
    .from('tournament_registrations')
    .select('registration_details, tournaments!inner(game_id)')
    .eq('tournaments.game_id', gameId)
    .limit(1000)
  // A failed check must not fail open into a hard delete — deactivating a
  // field nobody ever used costs nothing (it's the same operation the
  // "history found" branch already does), while wrongly hard-deleting one
  // that's still referenced loses its label everywhere it's displayed.
  const hasHistory = historyError || (regs ?? []).some((r) => field.field_key in ((r.registration_details as Record<string, unknown>) ?? {}))

  const { error } = hasHistory
    ? await supabase.from('game_registration_fields').update({ active: false }).eq('id', id)
    : await supabase.from('game_registration_fields').delete().eq('id', id)
  if (error) return { error: 'Could not remove the field.' }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}

export async function reorderRegistrationFields(
  _prev: RegistrationFieldActionState,
  formData: FormData,
): Promise<RegistrationFieldActionState> {
  await requireStaff()
  const gameId = String(formData.get('gameId') ?? '')
  const orderedIds = JSON.parse(String(formData.get('orderedIds') ?? '[]')) as string[]
  if (!gameId || orderedIds.length === 0) return { error: 'Nothing to reorder.' }

  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('game_registration_fields').update({ seq: i + 1 }).eq('id', orderedIds[i])
    if (error) return { error: 'Could not save the new order.' }
  }

  revalidatePath(`/admin/games/${gameId}`)
  return { success: true }
}
