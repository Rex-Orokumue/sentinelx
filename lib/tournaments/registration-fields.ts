import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export interface RegistrationField {
  fieldKey: string
  label: string
  placeholder: string | null
  inputType: 'text' | 'number' | 'url'
  required: boolean
  validationPattern: string | null
  validationMessage: string | null
  showOnBracket: boolean
}

// One dynamic zod object, built from whatever fields a game declares. Every
// registration/waitlist code path (web Server Actions, mobile endpoints)
// calls this instead of hand-writing clubName/ignTag.
export function buildRegistrationSchema(fields: RegistrationField[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    let str = z.string().trim().max(120, `${f.label} is too long`)
    if (f.validationPattern) {
      str = str.regex(new RegExp(f.validationPattern), f.validationMessage ?? `${f.label} is invalid`)
    }
    shape[f.fieldKey] = f.required
      ? str.min(1, `${f.label} is required`)
      : z.union([z.literal(''), str])
  }
  return z.object(shape)
}

export async function fetchRegistrationFields(
  supabase: SupabaseClient<Database>,
  gameId: string,
): Promise<RegistrationField[]> {
  const { data } = await supabase
    .from('game_registration_fields')
    .select('field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket')
    .eq('game_id', gameId)
    .eq('active', true)
    .order('seq')
  return (data ?? []).map((f) => ({
    fieldKey: f.field_key,
    label: f.label,
    placeholder: f.placeholder,
    inputType: f.input_type as RegistrationField['inputType'],
    required: f.required,
    validationPattern: f.validation_pattern,
    validationMessage: f.validation_message,
    showOnBracket: f.show_on_bracket,
  }))
}

// First field (in the given order) whose value is present and non-empty —
// used wherever a single identifying value is shown next to a player's name
// (the public bracket, the admin results queue), not the full detail set.
export function pickDisplayValue(details: Record<string, unknown> | null, fields: RegistrationField[]): string | null {
  if (!details) return null
  for (const f of fields) {
    const v = details[f.fieldKey]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}
