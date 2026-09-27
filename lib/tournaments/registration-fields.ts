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
export function buildRegistrationSchema(fields: RegistrationField[]): z.ZodType<Record<string, string>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    let str = z.string().trim().max(120, `${f.label} is too long`)
    if (f.validationPattern) {
      // The admin form rejects an unparseable pattern before it's ever
      // saved (registration-fields-schema.ts), but the spec allows seeding
      // fields via raw SQL too, which bypasses that check. A bad pattern
      // already in the database must not crash every registration for that
      // game — skip it rather than let `new RegExp` throw.
      try {
        str = str.regex(new RegExp(f.validationPattern), f.validationMessage ?? `${f.label} is invalid`)
      } catch (e) {
        console.error('[registration-fields] invalid validation_pattern, ignoring', { fieldKey: f.fieldKey, pattern: f.validationPattern, message: e instanceof Error ? e.message : String(e) })
      }
    }
    const fieldSchema = f.required
      ? str.min(1, `${f.label} is required`)
      : z.union([z.literal(''), str])
    // Mobile sends registrationDetails as a plain object and may omit an
    // untouched field's key entirely (unlike the web form, which always
    // sends every field via formData.get(k) ?? ''). Without this, a missing
    // key fails zod's base string check before .min()/the union ever runs,
    // producing "expected string, received undefined" instead of the
    // friendly message above, and rejects an omitted OPTIONAL field outright.
    shape[f.fieldKey] = z.preprocess((v) => (v === undefined || v === null ? '' : v), fieldSchema)
  }
  // Every branch above always outputs a string, so the object's inferred
  // shape is safe to widen to Record<string, string> for callers
  // (register-service/waitlist-service write it straight into a jsonb
  // column typed that way) — z.object(shape)'s own inferred type can't
  // express that since `shape`'s declared value type is the general
  // ZodTypeAny, not each field's specific schema.
  return z.object(shape) as unknown as z.ZodType<Record<string, string>>
}

export async function fetchRegistrationFields(
  supabase: SupabaseClient<Database>,
  gameId: string,
): Promise<RegistrationField[]> {
  const { data, error } = await supabase
    .from('game_registration_fields')
    .select('field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket')
    .eq('game_id', gameId)
    .eq('active', true)
    .order('seq')
  // A transient failure here must not silently produce an empty catalogue —
  // a write path (register/waitlist) would then skip every required field
  // and save registration_details = {} unchecked. Read-only display callers
  // (bracket-view, admin tables) catch this and fall back to [] themselves.
  if (error) throw new Error(`Could not load registration fields: ${error.message}`)
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

// For display-only callers (the public registration form's field list, the
// bracket, admin tables) — a transient failure here should degrade to "no
// fields configured" rather than crash a page every visitor sees. Write
// paths (register/waitlist Server Actions and mobile endpoints) call
// fetchRegistrationFields directly and let a failure reject the request
// instead, since silently building an empty schema there would skip
// required-field validation entirely.
export async function safeFetchRegistrationFields(
  supabase: SupabaseClient<Database>,
  gameId: string,
): Promise<RegistrationField[]> {
  try {
    return await fetchRegistrationFields(supabase, gameId)
  } catch (e) {
    console.error('[registration-fields] safeFetchRegistrationFields failed, showing no fields', { gameId, message: e instanceof Error ? e.message : String(e) })
    return []
  }
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
