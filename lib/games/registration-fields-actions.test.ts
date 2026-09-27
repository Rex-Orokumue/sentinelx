import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createRegistrationField, deleteRegistrationField } from './registration-fields-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createRegistrationField', () => {
  it('rejects an invalid validation pattern before touching the database', async () => {
    const result = await createRegistrationField(undefined, formDataFrom({
      gameId: 'g1', fieldKey: 'uid', label: 'UID', placeholder: '', inputType: 'text',
      required: 'true', validationPattern: '(unclosed', validationMessage: '', showOnBracket: 'false',
    }))
    expect(result?.error).toMatch(/valid regular expression/)
  })
})

describe('deleteRegistrationField', () => {
  it('requires an id', async () => {
    const result = await deleteRegistrationField(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('hard-deletes when no registration has used this field', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { field_key: 'in_game_uid' } }) }) }), delete: deleteFn, update: updateFn }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteRegistrationField(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails, since a false negative is destructive', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { field_key: 'in_game_uid' } }) }) }), delete: deleteFn, update: updateFn }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteRegistrationField(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a past registration used this field', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_registration_fields') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { field_key: 'in_game_uid' } }) }) }), delete: deleteFn, update: updateFn }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ registration_details: { in_game_uid: '778899' } }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteRegistrationField(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})
