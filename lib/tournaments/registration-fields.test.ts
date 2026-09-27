import { describe, it, expect } from 'vitest'
import { buildRegistrationSchema, fetchRegistrationFields, safeFetchRegistrationFields, pickDisplayValue, type RegistrationField } from './registration-fields'

const clubName: RegistrationField = {
  fieldKey: 'club_name', label: 'Club name', placeholder: null, inputType: 'text',
  required: true, validationPattern: null, validationMessage: null, showOnBracket: true,
}
const ignTag: RegistrationField = {
  fieldKey: 'ign_tag', label: 'IGN', placeholder: null, inputType: 'text',
  required: false, validationPattern: null, validationMessage: null, showOnBracket: false,
}
const uid: RegistrationField = {
  fieldKey: 'in_game_uid', label: 'In-game UID', placeholder: null, inputType: 'text',
  required: true, validationPattern: '^[0-9]+$', validationMessage: 'UID must be numeric', showOnBracket: true,
}

describe('buildRegistrationSchema', () => {
  it('requires a required field', () => {
    const schema = buildRegistrationSchema([clubName])
    expect(schema.safeParse({ club_name: '' }).success).toBe(false)
    expect(schema.safeParse({ club_name: 'Lagos Ronin' }).success).toBe(true)
  })

  it('allows an empty optional field', () => {
    const schema = buildRegistrationSchema([ignTag])
    expect(schema.safeParse({ ign_tag: '' }).success).toBe(true)
  })

  it('enforces a validation pattern with its message', () => {
    const schema = buildRegistrationSchema([uid])
    const bad = schema.safeParse({ in_game_uid: 'not-numeric' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0].message).toBe('UID must be numeric')
    expect(schema.safeParse({ in_game_uid: '123456789' }).success).toBe(true)
  })

  it('produces an empty object schema for no fields', () => {
    const schema = buildRegistrationSchema([])
    expect(schema.safeParse({}).success).toBe(true)
  })

  it('accepts an optional field whose key is entirely missing from the input, not just empty', () => {
    // Mobile sends registrationDetails as a plain object and may omit an
    // untouched optional field entirely, unlike the web form which always
    // sends every field (blank or not) via formData.get(k) ?? ''.
    const schema = buildRegistrationSchema([ignTag])
    expect(schema.safeParse({}).success).toBe(true)
  })

  it('gives the friendly "required" message when a required field key is missing entirely', () => {
    const schema = buildRegistrationSchema([clubName])
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe('Club name is required')
  })

  it('ignores an invalid regex pattern instead of throwing when building the schema', () => {
    // The admin form rejects an invalid pattern before it's ever saved, but
    // the spec allows seeding fields via raw SQL too, which bypasses that
    // check — a bad pattern already in the database must not crash every
    // registration for that game.
    const broken: RegistrationField = { ...uid, validationPattern: '(unclosed' }
    expect(() => buildRegistrationSchema([broken])).not.toThrow()
    const schema = buildRegistrationSchema([broken])
    // No enforceable pattern, so any non-empty value passes.
    expect(schema.safeParse({ in_game_uid: 'not-numeric' }).success).toBe(true)
  })
})

describe('fetchRegistrationFields', () => {
  it('throws on a database error instead of silently returning an empty catalogue', async () => {
    // A transient failure here must not let a write path (register/waitlist)
    // build an empty schema and save registration_details = {} unchecked —
    // it must fail the request, not fail open.
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: null, error: { message: 'connection reset' } }),
            }),
          }),
        }),
      }),
    }
    await expect(fetchRegistrationFields(supabase as never, 'g1')).rejects.toThrow(/connection reset/)
  })
})

describe('safeFetchRegistrationFields', () => {
  it('degrades to an empty list instead of throwing, for display-only callers', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: null, error: { message: 'connection reset' } }),
            }),
          }),
        }),
      }),
    }
    await expect(safeFetchRegistrationFields(supabase as never, 'g1')).resolves.toEqual([])
  })
})

describe('pickDisplayValue', () => {
  it('returns the first field in order with a non-empty value', () => {
    expect(pickDisplayValue({ ign_tag: '', club_name: 'Lagos Ronin' }, [clubName, ignTag])).toBe('Lagos Ronin')
  })

  it('returns null when no field has a value', () => {
    expect(pickDisplayValue({}, [clubName])).toBeNull()
    expect(pickDisplayValue(null, [clubName])).toBeNull()
  })
})
