import { describe, it, expect } from 'vitest'
import { buildRegistrationSchema, pickDisplayValue, type RegistrationField } from './registration-fields'

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
